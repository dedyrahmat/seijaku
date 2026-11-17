import {
	decodeFrame,
	encodeAck,
	encodeEntry,
	encodeNotify,
	encodeReady,
	FrameKind,
	MAX_FRAME_BYTES,
} from "./protocol";
import type { UpdateStore } from "./store";

/** What the Room needs from a socket, whatever runtime it comes from. */
export interface RoomConnection {
	send(data: Uint8Array): void;
	close?(code: number, reason: string): void;
}

interface DocEntry {
	peers: Set<Peer>;
	/** Everything that touches this doc's log runs here, one at a time, in arrival order. */
	chain: Promise<void>;
}

/**
 * One workspace room: every doc of one workspace behind a single connection per device.
 * Runtime-agnostic. The Bun server holds one in process; Cloudflare holds one per
 * Durable Object. Only talks to sockets through `RoomConnection` and to disk through
 * `UpdateStore`.
 *
 * The room is blind: it appends sealed blobs, numbers them, relays them and tells devices
 * when a doc they are not watching changed. It never decodes a blob, so it holds no docs
 * in memory and cannot read a note.
 */
export class Room {
	private docs = new Map<string, DocEntry>();
	private peers = new Set<Peer>();

	constructor(private store: UpdateStore) {}

	/** Registers a new device connection. */
	join(conn: RoomConnection): Peer {
		const peer = new Peer(this, conn, this.store);
		this.peers.add(peer);
		return peer;
	}

	/** Resolves once everything received so far has been written to the store. */
	async flush(): Promise<void> {
		await Promise.all([...this.docs.values()].map((e) => e.chain));
	}

	/** Number of docs with a subscriber or work in flight. */
	get loadedDocs(): number {
		return this.docs.size;
	}

	/** @internal */
	entryFor(docId: string): DocEntry {
		let entry = this.docs.get(docId);
		if (!entry) {
			entry = { peers: new Set(), chain: Promise.resolve() };
			this.docs.set(docId, entry);
		}
		return entry;
	}

	/** @internal Runs `work` after everything already queued for the doc. */
	run(docId: string, work: (entry: DocEntry) => Promise<void>): Promise<void> {
		const entry = this.entryFor(docId);
		const next = entry.chain
			.then(() => work(entry))
			.catch((err) => {
				console.error(`[room] work on ${docId} failed`, err);
			});
		entry.chain = next;
		void next.then(() => this.evictIfUnused(docId, entry));
		return next;
	}

	/** @internal */
	evictIfUnused(docId: string, entry: DocEntry): void {
		if (entry.peers.size === 0 && this.docs.get(docId) === entry) {
			void entry.chain.then(() => {
				// Check and delete in one synchronous step so a peer that subscribed meanwhile keeps it.
				if (entry.peers.size === 0 && this.docs.get(docId) === entry)
					this.docs.delete(docId);
			});
		}
	}

	/** @internal Every other device hears about a new entry: live if subscribed, else a notice. */
	relay(docId: string, from: Peer, seq: number, blob: Uint8Array): void {
		const entry = this.docs.get(docId);
		for (const peer of this.peers) {
			if (peer === from) continue;
			if (entry?.peers.has(peer)) peer.send(encodeEntry(docId, seq, blob));
			else peer.notify(docId);
		}
	}

	/** @internal */
	removePeer(peer: Peer): void {
		this.peers.delete(peer);
		for (const docId of [...peer.subscriptions]) peer.unsubscribe(docId);
	}
}

export class Peer {
	/** Docs this device receives live entries for. */
	readonly subscriptions = new Set<string>();
	/** Docs we already sent a change notice for since the device last looked at them. */
	private notified = new Set<string>();
	private queue: Promise<void> = Promise.resolve();
	private closed = false;

	constructor(
		private room: Room,
		private conn: RoomConnection,
		private store: UpdateStore,
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

		switch (frame.kind) {
			case FrameKind.Unsubscribe:
				if (this.subscriptions.has(docId)) this.unsubscribe(docId);
				return;

			case FrameKind.Subscribe:
				// History and the subscription are one step on the doc's chain, so no entry can
				// slip in between "what was stored" and "what is live".
				await this.room.run(docId, async (entry) => {
					if (this.closed) return;
					for (const e of await this.store.loadAfter(docId, frame.afterSeq))
						this.send(encodeEntry(docId, e.seq, e.data));
					const { head, count } = await this.store.stat(docId);
					this.subscriptions.add(docId);
					this.notified.delete(docId);
					entry.peers.add(this);
					this.send(encodeReady(docId, head, count));
				});
				return;

			case FrameKind.Push:
				await this.room.run(docId, async () => {
					const seq = await this.store.append(docId, frame.blob);
					// Ack only once it is on disk, so "Synced" in the UI is honest.
					this.send(encodeAck(docId, seq));
					this.room.relay(docId, this, seq, frame.blob);
				});
				return;

			case FrameKind.Snapshot:
				await this.room.run(docId, async () => {
					const { head } = await this.store.stat(docId);
					if (frame.upto < 1 || frame.upto > head) return;
					await this.store.replaceUpTo(docId, frame.upto, frame.blob);
				});
				return;

			default:
				return;
		}
	}
}
