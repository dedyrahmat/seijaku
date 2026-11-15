import * as Y from "yjs";
import {
	applySyncMessage,
	decodeFrame,
	encodeAck,
	encodeNotify,
	encodeSyncStep1,
	encodeUpdate,
	FrameKind,
	MAX_FRAME_BYTES,
} from "./protocol";
import type { UpdateStore } from "./store";

/** What the Room needs from a socket, whatever runtime it comes from. */
export interface RoomConnection {
	send(data: Uint8Array): void;
	close?(code: number, reason: string): void;
}

export interface RoomOptions {
	/** Merge a doc's update log into one entry once it grows past this many. */
	compactAfter?: number;
}

interface DocEntry {
	doc: Y.Doc;
	ready: Promise<void>;
	peers: Set<Peer>;
	/** Updates currently in the store, used to decide when to compact. */
	logged: number;
	/** Tail of the per-doc write chain; awaiting it means everything queued is stored. */
	writes: Promise<void>;
}

/**
 * One workspace room: every doc of one workspace behind a single connection per device.
 * Runtime-agnostic. The Bun server holds one in process; Cloudflare holds one per
 * Durable Object. Only talks to sockets through `RoomConnection` and to disk through
 * `UpdateStore`.
 */
export class Room {
	private docs = new Map<string, DocEntry>();
	private peers = new Set<Peer>();
	private compactAfter: number;

	constructor(
		private store: UpdateStore,
		options: RoomOptions = {},
	) {
		this.compactAfter = options.compactAfter ?? 100;
	}

	/** Registers a new device connection. */
	join(conn: RoomConnection): Peer {
		const peer = new Peer(this, conn);
		this.peers.add(peer);
		return peer;
	}

	/** Resolves once every update received so far has been written to the store. */
	async flush(): Promise<void> {
		await Promise.all([...this.docs.values()].map((e) => e.writes));
	}

	/** Number of docs held in memory (docs with no subscribers are dropped). */
	get loadedDocs(): number {
		return this.docs.size;
	}

	/** Current state of a doc, loading it if needed. For tests and server-side readers (history, share). */
	async readDoc(docId: string): Promise<Uint8Array> {
		const entry = this.entryFor(docId);
		await entry.ready;
		const state = Y.encodeStateAsUpdate(entry.doc);
		this.evictIfUnused(docId, entry);
		return state;
	}

	/** @internal */
	entryFor(docId: string): DocEntry {
		const existing = this.docs.get(docId);
		if (existing) return existing;
		const doc = new Y.Doc();
		const entry: DocEntry = {
			doc,
			peers: new Set(),
			logged: 0,
			writes: Promise.resolve(),
			ready: Promise.resolve(),
		};
		entry.ready = (async () => {
			const updates = await this.store.load(docId);
			Y.transact(doc, () => {
				for (const u of updates) Y.applyUpdate(doc, u);
			});
			entry.logged = updates.length;
			// Listen only after loading so replaying the log is not re-appended to it.
			doc.on("update", (update: Uint8Array, origin: unknown) =>
				this.onUpdate(docId, entry, update, origin),
			);
		})();
		this.docs.set(docId, entry);
		return entry;
	}

	private onUpdate(
		docId: string,
		entry: DocEntry,
		update: Uint8Array,
		origin: unknown,
	): void {
		entry.writes = entry.writes
			.then(async () => {
				await this.store.append(docId, update);
				entry.logged += 1;
				if (entry.logged > this.compactAfter) {
					await this.store.replaceAll(docId, Y.encodeStateAsUpdate(entry.doc));
					entry.logged = 1;
				}
			})
			.catch((err) => {
				// A failed write must not wedge the chain; the next update's state vector diff
				// lets clients re-send what is missing after a reconnect.
				console.error(`[room] failed to store update for ${docId}`, err);
			});

		for (const peer of this.peers) {
			if (peer === origin) continue;
			if (entry.peers.has(peer)) peer.send(encodeUpdate(docId, update));
			else peer.notify(docId);
		}
	}

	/** @internal */
	evictIfUnused(docId: string, entry: DocEntry): void {
		if (entry.peers.size > 0) return;
		void entry.writes.then(() => {
			// Check and delete in one synchronous step so a peer that subscribed meanwhile keeps the doc.
			if (entry.peers.size === 0 && this.docs.get(docId) === entry) {
				this.docs.delete(docId);
				entry.doc.destroy();
			}
		});
	}

	/** @internal */
	removePeer(peer: Peer): void {
		this.peers.delete(peer);
		for (const docId of [...peer.subscriptions]) peer.unsubscribe(docId);
	}
}

export class Peer {
	/** Docs this device receives live updates for. */
	readonly subscriptions = new Set<string>();
	/** Docs we already sent a change notice for since the device last looked at them. */
	private notified = new Set<string>();
	private queue: Promise<void> = Promise.resolve();
	private closed = false;

	constructor(
		private room: Room,
		private conn: RoomConnection,
	) {}

	/** @internal */
	send(data: Uint8Array): void {
		if (this.closed) return;
		try {
			this.conn.send(data);
		} catch {
			// Socket already gone; leave() will clean up.
		}
	}

	/** @internal One notice per doc until the device subscribes, not one per keystroke. */
	notify(docId: string): void {
		if (this.notified.has(docId)) return;
		this.notified.add(docId);
		this.send(encodeNotify(docId));
	}

	/** Feed one binary frame from the device. Frames are handled strictly in order. */
	receive(data: Uint8Array): Promise<void> {
		if (data.byteLength > MAX_FRAME_BYTES) {
			this.conn.close?.(1009, "frame too large");
			return Promise.resolve();
		}
		this.queue = this.queue
			.then(() => this.handle(data))
			.catch((err) => {
				console.error("[room] dropped a frame", err);
			});
		return this.queue;
	}

	/** Call when the socket closes. */
	leave(): void {
		if (this.closed) return;
		this.closed = true;
		this.room.removePeer(this);
	}

	/** @internal */
	unsubscribe(docId: string): void {
		this.subscriptions.delete(docId);
		this.notified.delete(docId);
		const entry = this.room.entryFor(docId);
		entry.peers.delete(this);
		this.room.evictIfUnused(docId, entry);
	}

	private async handle(data: Uint8Array): Promise<void> {
		const frame = decodeFrame(data);
		if (!frame || this.closed) return;
		const { docId } = frame;

		if (frame.kind === FrameKind.Unsubscribe) {
			if (this.subscriptions.has(docId)) this.unsubscribe(docId);
			return;
		}
		if (frame.kind !== FrameKind.Sync) return;

		const entry = this.room.entryFor(docId);
		// Subscribing is a synchronous step so the doc cannot be evicted while we wait for it to load.
		const subscribing = !this.subscriptions.has(docId);
		if (subscribing) {
			this.subscriptions.add(docId);
			this.notified.delete(docId);
			entry.peers.add(this);
		}
		await entry.ready;
		if (this.closed) return;

		const result = applySyncMessage(docId, frame.body, entry.doc, this);
		if (result.wasStep1) {
			// Ask for what the device has that we lack; it answers with a step 2. Sent before our
			// own step 2 so the device knows it still owes us data when it finishes the handshake.
			this.send(encodeSyncStep1(docId, entry.doc));
		}
		if (result.reply) this.send(result.reply);
		if (result.carriedData) {
			// Ack only once the update is on disk, so "Synced" in the UI is honest.
			await entry.writes;
			this.send(encodeAck(docId));
		}
	}
}
