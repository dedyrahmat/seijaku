import type * as Y from "yjs";
import {
	applySyncMessage,
	decodeFrame,
	encodeSyncStep1,
	encodeUnsubscribe,
	encodeUpdate,
	FrameKind,
	PING,
} from "./protocol";

/** The slice of the browser WebSocket the client uses; tests supply a fake. */
export interface SocketLike {
	binaryType: string;
	readyState: number;
	onopen: ((ev: unknown) => void) | null;
	onmessage: ((ev: { data: unknown }) => void) | null;
	onclose: ((ev: unknown) => void) | null;
	onerror: ((ev: unknown) => void) | null;
	send(data: Uint8Array | string): void;
	close(code?: number, reason?: string): void;
}

const OPEN = 1;

export type SyncStatus = "offline" | "syncing" | "synced";

export interface SyncState {
	status: SyncStatus;
	/** Messages sent to the server that it has not yet confirmed as stored. */
	pending: number;
	/** When the server last confirmed everything, or null if never this session. */
	lastSyncedAt: number | null;
}

export interface SyncClientOptions {
	/** Re-read on every connection attempt, so a changed server address takes effect. */
	url: () => string;
	createSocket?: (url: string) => SocketLike;
	/** Reconnect delay bounds in ms. */
	minDelay?: number;
	maxDelay?: number;
	pingEvery?: number;
	deadAfter?: number;
	now?: () => number;
	random?: () => number;
}

interface Attached {
	docId: string;
	doc: Y.Doc;
	/** Background catch-up of a doc nobody is looking at; does not show in the status. */
	quiet: boolean;
	/** The server has answered our step 1 on the current connection. */
	handshaken: boolean;
	pending: number;
	onUpdate: (update: Uint8Array, origin: unknown) => void;
	waiters: Set<(ok: boolean) => void>;
}

export interface Attachment {
	/** Resolves true once the doc matches the server, false if the connection drops first. */
	whenSynced(): Promise<boolean>;
	detach(): void;
}

/**
 * One WebSocket to the workspace room, carrying every attached doc.
 * Offline-first: nothing here blocks local editing. It connects, handshakes each doc
 * by state vector, streams local edits, and reconnects with backoff when the link drops.
 */
export class SyncClient {
	private socket: SocketLike | null = null;
	private docs = new Map<string, Attached>();
	private listeners = new Set<() => void>();
	private notifyListeners = new Set<(docId: string) => void>();
	private state: SyncState = {
		status: "offline",
		pending: 0,
		lastSyncedAt: null,
	};
	private attempt = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private pingTimer: ReturnType<typeof setInterval> | null = null;
	private lastRx = 0;
	private running = false;
	private opts: Required<Omit<SyncClientOptions, "url" | "createSocket">> &
		Pick<SyncClientOptions, "url" | "createSocket">;

	constructor(options: SyncClientOptions) {
		this.opts = {
			minDelay: 500,
			maxDelay: 30_000,
			pingEvery: 15_000,
			deadAfter: 40_000,
			now: Date.now,
			random: Math.random,
			...options,
		};
	}

	getState = (): SyncState => this.state;

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	/** Called when another device changed a doc this one is not subscribed to. */
	onNotify(listener: (docId: string) => void): () => void {
		this.notifyListeners.add(listener);
		return () => this.notifyListeners.delete(listener);
	}

	start(): void {
		if (this.running) return;
		this.running = true;
		this.connect();
	}

	stop(): void {
		this.running = false;
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.reconnectTimer = null;
		this.socket?.close(1000, "stopped");
		this.dropSocket();
	}

	/** Skip the backoff wait, e.g. when the browser reports it is back online. */
	reconnectNow(): void {
		if (!this.running) return;
		if (this.socket && this.socket.readyState <= OPEN) return;
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.reconnectTimer = null;
		this.connect();
	}

	attach(docId: string, doc: Y.Doc, quiet = false): Attachment {
		const prev = this.docs.get(docId);
		if (prev) this.release(prev, false);

		const entry: Attached = {
			docId,
			doc,
			quiet,
			handshaken: false,
			pending: 0,
			waiters: new Set(),
			onUpdate: (update, origin) => {
				if (origin === this) return; // came from the server
				if (this.isOpen()) {
					entry.pending += 1;
					this.send(encodeUpdate(docId, update));
				}
				this.recompute();
			},
		};
		doc.on("update", entry.onUpdate);
		this.docs.set(docId, entry);
		if (this.isOpen()) this.send(encodeSyncStep1(docId, doc));
		this.recompute();

		return {
			whenSynced: () => this.whenSynced(entry),
			detach: () => {
				if (this.docs.get(docId) === entry) this.release(entry, true);
			},
		};
	}

	private whenSynced(entry: Attached): Promise<boolean> {
		if (this.isOpen() && entry.handshaken && entry.pending === 0)
			return Promise.resolve(true);
		return new Promise((resolve) => entry.waiters.add(resolve));
	}

	private release(entry: Attached, tellServer: boolean): void {
		entry.doc.off("update", entry.onUpdate);
		this.docs.delete(entry.docId);
		for (const w of entry.waiters) w(false);
		entry.waiters.clear();
		if (tellServer && this.isOpen()) this.send(encodeUnsubscribe(entry.docId));
		this.recompute();
	}

	private isOpen(): boolean {
		return this.socket?.readyState === OPEN;
	}

	private send(data: Uint8Array | string): void {
		try {
			this.socket?.send(data);
		} catch {
			// The close handler will reconnect.
		}
	}

	private connect(): void {
		if (!this.running) return;
		let socket: SocketLike;
		try {
			const url = this.opts.url();
			socket = this.opts.createSocket
				? this.opts.createSocket(url)
				: (new WebSocket(url) as unknown as SocketLike);
		} catch {
			this.scheduleReconnect();
			return;
		}
		socket.binaryType = "arraybuffer";
		this.socket = socket;
		let heard = false;

		socket.onopen = () => {
			if (this.socket !== socket) return;
			this.lastRx = this.opts.now();
			this.handshakeAll();
			this.pingTimer = setInterval(() => {
				if (this.opts.now() - this.lastRx > this.opts.deadAfter) {
					// Half-open connection: browsers give no close event for a vanished network.
					socket.close(4000, "no heartbeat");
					this.onSocketGone(socket);
					return;
				}
				this.send(PING);
			}, this.opts.pingEvery);
			this.recompute();
		};

		socket.onmessage = (ev) => {
			if (this.socket !== socket) return;
			this.lastRx = this.opts.now();
			if (!heard) {
				heard = true;
				this.attempt = 0; // a connection that answers counts as healthy
			}
			if (typeof ev.data === "string") return; // "pong": hearing it was the point

			this.receive(new Uint8Array(ev.data as ArrayBuffer));
		};

		const gone = () => this.onSocketGone(socket);
		socket.onclose = gone;
		socket.onerror = gone;
		this.recompute();
	}

	/** Start over with every attached doc: tell the server what we have and ask for what we lack. */
	private handshakeAll(): void {
		for (const e of this.docs.values()) {
			e.handshaken = false;
			e.pending = 0;
			this.send(encodeSyncStep1(e.docId, e.doc));
		}
		this.recompute();
	}

	private onSocketGone(socket: SocketLike): void {
		if (this.socket !== socket) return;
		this.dropSocket();
		this.scheduleReconnect();
	}

	private dropSocket(): void {
		if (this.pingTimer) clearInterval(this.pingTimer);
		this.pingTimer = null;
		const socket = this.socket;
		this.socket = null;
		if (socket) {
			socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
			try {
				socket.close();
			} catch {}
		}
		for (const e of this.docs.values()) {
			e.handshaken = false;
			e.pending = 0;
			for (const w of e.waiters) w(false);
			e.waiters.clear();
		}
		this.recompute();
	}

	private scheduleReconnect(): void {
		if (!this.running || this.reconnectTimer) return;
		const { minDelay, maxDelay, random } = this.opts;
		const ceiling = Math.min(maxDelay, minDelay * 2 ** this.attempt);
		const delay = ceiling * (0.5 + random() / 2); // jitter so devices do not stampede
		this.attempt += 1;
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.connect();
		}, delay);
	}

	private receive(data: Uint8Array): void {
		const frame = decodeFrame(data);
		if (!frame) return;

		if (frame.kind === FrameKind.Resync) {
			this.handshakeAll();
			return;
		}
		if (frame.kind === FrameKind.Notify) {
			for (const l of this.notifyListeners) l(frame.docId);
			return;
		}
		const entry = this.docs.get(frame.docId);
		if (!entry) return;

		if (frame.kind === FrameKind.Ack) {
			entry.pending = Math.max(0, entry.pending - 1);
		} else if (frame.kind === FrameKind.Sync) {
			try {
				const result = applySyncMessage(
					frame.docId,
					frame.body,
					entry.doc,
					this,
				);
				if (result.wasStep2) entry.handshaken = true;
				if (result.reply) {
					entry.pending += 1;
					this.send(result.reply);
				}
			} catch (err) {
				console.error("[sync] bad frame from server", err);
				return;
			}
		}
		this.settle(entry);
		this.recompute();
	}

	private settle(entry: Attached): void {
		if (entry.handshaken && entry.pending === 0) {
			for (const w of entry.waiters) w(true);
			entry.waiters.clear();
		}
	}

	private recompute(): void {
		let pending = 0;
		let waiting = false;
		for (const e of this.docs.values()) {
			if (e.quiet) continue;
			pending += e.pending;
			if (!e.handshaken) waiting = true;
		}
		const open = this.isOpen();
		const status: SyncStatus = !open
			? "offline"
			: waiting || pending > 0
				? "syncing"
				: "synced";
		const prev = this.state;
		if (prev.status === status && prev.pending === pending) return;
		// Every return to "synced" is a fresh confirmation from the server.
		const lastSyncedAt =
			status === "synced" ? this.opts.now() : prev.lastSyncedAt;
		this.state = { status, pending, lastSyncedAt };
		for (const l of this.listeners) l();
	}
}
