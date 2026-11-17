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
		if (request.headers.get("Upgrade") !== "websocket") {
			return new Response("Expected a WebSocket upgrade", { status: 426 });
		}
		const pair = new WebSocketPair();
		const [client, server] = [pair[0], pair[1]];
		this.ctx.acceptWebSocket(server);
		this.adopt(server, false);
		return new Response(null, { status: 101, webSocket: client });
	}

	private adopt(ws: WebSocket, resync: boolean): Peer {
		const peer = this.room.join({
			send: (data) => ws.send(toBuffer(data)),
			close: (code, reason) => ws.close(code, reason),
		});
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
