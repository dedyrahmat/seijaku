import { DurableObject } from "cloudflare:workers";
import { logMigrations } from "@seijaku/db";
import { encodeResync, MAX_FRAME_BYTES, type Peer, Room } from "@seijaku/sync";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { SqlUpdateStore } from "./sql-store";

/**
 * Cloudflare entry for the workspace room: one Durable Object per workspace, update log in
 * the object's own SQLite, sockets accepted through the hibernation API so an idle
 * workspace costs nothing.
 *
 * When the object wakes from hibernation its in-memory Room is gone, but the sockets are
 * still connected. Each one gets a fresh Peer and a Resync frame, and the device answers by
 * subscribing to its docs again.
 */

function toBuffer(u: Uint8Array): ArrayBuffer {
	return u.buffer.slice(
		u.byteOffset,
		u.byteOffset + u.byteLength,
	) as ArrayBuffer;
}

export class WorkspaceRoom extends DurableObject {
	private room: Room;
	private peers = new Map<WebSocket, Peer>();
	/** A shared page's room remembers each socket's member and role across hibernation. */
	private who = new Map<WebSocket, { userId: string; role: string }>();

	constructor(ctx: DurableObjectState, env: unknown) {
		super(ctx, env as never);
		const db = drizzle(ctx.storage);
		migrate(db, { migrations: logMigrations });
		this.room = new Room(new SqlUpdateStore(db));
		// Keep-alive pings are answered without waking the object.
		ctx.setWebSocketAutoResponse(
			new WebSocketRequestResponsePair("ping", "pong"),
		);
		// Constructed again after hibernation: reattach sockets that are still open.
		for (const ws of ctx.getWebSockets()) this.adopt(ws, true);
	}

	override async fetch(request: Request): Promise<Response> {
		// A member was removed or changed role: hang up on their devices only.
		const kick = new URL(request.url).searchParams.get("kick");
		if (request.method === "DELETE" && kick) {
			for (const ws of this.ctx.getWebSockets())
				if (this.attachment(ws)?.userId === kick)
					ws.close(4003, "access changed");
			return new Response(null, { status: 204 });
		}
		// Account deleted, or a shared page's key changed: hang up on every device and drop the whole log.
		if (request.method === "DELETE") {
			this.room.closeAll(4001, "account deleted");
			await this.room.flush();
			await this.ctx.storage.deleteAll();
			return new Response(null, { status: 204 });
		}
		if (request.headers.get("Upgrade") !== "websocket") {
			return new Response("Expected a WebSocket upgrade", { status: 426 });
		}
		const pair = new WebSocketPair();
		const [client, server] = [pair[0], pair[1]];
		this.ctx.acceptWebSocket(server);
		// Set by the worker after it checked membership: only a shared page's room gets them.
		const userId = request.headers.get("x-share-user");
		const role = request.headers.get("x-share-role");
		if (userId && role) server.serializeAttachment({ userId, role });
		this.adopt(server, false);
		return new Response(null, { status: 101, webSocket: client });
	}

	private attachment(ws: WebSocket): { userId: string; role: string } | null {
		const cached = this.who.get(ws);
		if (cached) return cached;
		const found = ws.deserializeAttachment() as {
			userId: string;
			role: string;
		} | null;
		if (found) this.who.set(ws, found);
		return found;
	}

	private adopt(ws: WebSocket, resync: boolean): Peer {
		const who = this.attachment(ws);
		const peer = this.room.join(
			{
				send: (data) => ws.send(toBuffer(data)),
				close: (code, reason) => ws.close(code, reason),
			},
			who ? { canWrite: () => who.role !== "reader", tag: who.userId } : {},
		);
		this.peers.set(ws, peer);
		if (resync) ws.send(toBuffer(encodeResync()));
		return peer;
	}

	override async webSocketMessage(
		ws: WebSocket,
		message: string | ArrayBuffer,
	): Promise<void> {
		if (typeof message === "string") return; // pings are auto-answered
		if (message.byteLength > MAX_FRAME_BYTES) {
			ws.close(1009, "frame too large");
			return;
		}
		const peer = this.peers.get(ws) ?? this.adopt(ws, true);
		await peer.receive(new Uint8Array(message));
	}

	override async webSocketClose(ws: WebSocket): Promise<void> {
		this.peers.get(ws)?.leave();
		this.peers.delete(ws);
	}

	override async webSocketError(ws: WebSocket): Promise<void> {
		this.peers.get(ws)?.leave();
		this.peers.delete(ws);
	}
}
