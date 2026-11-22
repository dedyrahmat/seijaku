import * as Y from "yjs";
import type { Cipher } from "./crypto";
import {
	decodeFrame,
	encodePush,
	encodeSnapshot,
	encodeSubscribe,
	encodeDrop,
	encodeUnsubscribe,
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

/** A device that sees this many entries stored for a doc folds them into one. */
const COMPACT_AFTER = 100;

export type SyncStatus = "offline" | "syncing" | "synced";

export interface SyncState {
	status: SyncStatus;
	/** Pushes sent to the server that it has not yet confirmed as stored. */
	pending: number;
	/** When the server last confirmed everything, or null if never this session. */
	lastSyncedAt: number | null;
}

export interface SyncClientOptions {
	/** Re-read on every connection attempt, so a changed server address takes effect. */
	url: () => string;
	/** The workspace key's cipher. While it returns null the client stays offline. */
	cipher: () => Cipher | null;
	createSocket?: (url: string) => SocketLike;
	/** Called when a connection attempt ends before the server ever answered, e.g. a refused sign-in. */
	onConnectFailed?: () => void;
	/** Reconnect delay bounds in ms. */
	minDelay?: number;
	maxDelay?: number;
	pingEvery?: number;
	deadAfter?: number;
	now?: () => number;
	random?: () => number;
}

/**
 * What a device remembers about one doc's relationship with the server, so a reload does not
 * download or upload the whole doc again: how far into the server's log it has read, and which
 * state the server is known to hold.
 */
export interface DocSyncState {
	lastSeq: number;
	/** Yjs state vector of everything the server is known to have. */
	remoteSV: Uint8Array;
	/** The server name these two belong to. Another account or key makes them void. */
	remoteId?: string;
}

export interface AttachOptions {
	/** Background catch-up of a doc nobody is looking at; does not show in the status. */
	quiet?: boolean;
	/** Saved by an earlier session; pass what `onState` last delivered. */
	state?: DocSyncState | null;
	/** Called (batched) whenever the state worth remembering changes. */
	onState?: (state: DocSyncState) => void;
}

interface Attached {
	docId: string;
	remoteId: string;
	doc: Y.Doc;
	quiet: boolean;
	/** The server has sent everything it had at subscribe time. */
	handshaken: boolean;
	/** Pushes sent on this connection and not yet acknowledged, oldest first. */
	queue: Uint8Array[];
	lastSeq: number;
	remoteSV: Map<number, number>;
	/** The server name that `lastSeq` and `remoteSV` were recorded under. */
	stateFor: string | undefined;
	saveState: ((s: DocSyncState) => void) | undefined;
	dirty: boolean;
	onUpdate: (update: Uint8Array, origin: unknown) => void;
	waiters: Set<(ok: boolean) => void>;
}

export interface Attachment {
	/** Resolves true once the doc matches the server, false if the connection drops first. */
	whenSynced(): Promise<boolean>;
	detach(): void;
}

/** Folds the clocks an update carries into a state vector, keeping the larger of each. */
function mergeSV(into: Map<number, number>, update: Uint8Array): void {
	const sv = Y.decodeStateVector(Y.encodeStateVectorFromUpdate(update));
	for (const [client, clock] of sv)
		if (clock > (into.get(client) ?? 0)) into.set(client, clock);
}

/**
 * One WebSocket to the workspace room, carrying every attached doc.
 * Offline-first: nothing here blocks local editing. It connects, reads what the server has
 * for each doc, uploads what the server lacks, streams local edits, and reconnects with
 * backoff when the link drops. Everything on the wire is sealed with the workspace key.
 */
export class SyncClient {
	private socket: SocketLike | null = null;
	/** Server names of deleted notes whose log the server has not been told to drop yet. */
	private drops = new Set<string>();
	private docs = new Map<string, Attached>();
	private byRemote = new Map<string, Attached>();
	/** Server names of docs we know about but may not have attached, for change notices. */
	private remoteToLocal = new Map<string, string>();
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
	/** Whether the current socket got as far as opening. */
	private opened = false;
	private opts: Required<
		Omit<
			SyncClientOptions,
			"url" | "cipher" | "createSocket" | "onConnectFailed"
		>
	> &
		Pick<
			SyncClientOptions,
			"url" | "cipher" | "createSocket" | "onConnectFailed"
		>;

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

	/** Lets change notices for this doc be reported by its local id. */
	learn(localId: string): void {
		const cipher = this.opts.cipher();
		if (cipher) this.remoteToLocal.set(cipher.remoteId(localId), localId);
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

	/**
	 * A note was deleted for good: ask the server to drop its log, now or on the next connection.
	 * shortcut: the wait is kept in memory only, so closing the app first leaves the sealed log behind.
	 */
	drop(localId: string): void {
		const cipher = this.opts.cipher();
		if (!cipher) return;
		this.drops.add(cipher.remoteId(localId));
		this.sendDrops();
	}

	private sendDrops(): void {
		if (!this.isOpen()) return;
		for (const id of this.drops) this.send(encodeDrop(id));
		this.drops.clear();
	}

	/** Skip the backoff wait, e.g. when the browser reports it is back online. */
	reconnectNow(): void {
		if (!this.running) return;
		if (this.socket && this.socket.readyState <= OPEN) return;
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.reconnectTimer = null;
		this.connect();
	}

	attach(
		docId: string,
		doc: Y.Doc,
		options: boolean | AttachOptions = false,
	): Attachment {
		const opts: AttachOptions =
			typeof options === "boolean" ? { quiet: options } : options;
		const prev = this.docs.get(docId);
		if (prev) this.release(prev, false);

		const remoteSV = new Map<number, number>();
		if (opts.state?.remoteSV.length)
			for (const [c, n] of Y.decodeStateVector(opts.state.remoteSV))
				remoteSV.set(c, n);
		const entry: Attached = {
			docId,
			remoteId: "", // known once the key is available

			doc,
			quiet: opts.quiet ?? false,
			handshaken: false,
			queue: [],
			lastSeq: opts.state?.lastSeq ?? 0,
			remoteSV,
			stateFor: opts.state?.remoteId,
			saveState: opts.onState,
			dirty: false,
			waiters: new Set(),
			onUpdate: (update, origin) => {
				if (origin === this) return; // came from the server
				// Until the server has answered, the upload after "ready" will carry this edit.
				if (this.isOpen() && entry.handshaken) this.push(entry, update);
				this.recompute();
			},
		};
		doc.on("update", entry.onUpdate);
		this.docs.set(docId, entry);
		if (this.isOpen()) this.subscribeDoc(entry);
		this.recompute();

		return {
			whenSynced: () => this.whenSynced(entry),
			detach: () => {
				if (this.docs.get(docId) === entry) this.release(entry, true);
			},
		};
	}

	private whenSynced(entry: Attached): Promise<boolean> {
		if (this.isOpen() && entry.handshaken && entry.queue.length === 0)
			return Promise.resolve(true);
		return new Promise((resolve) => entry.waiters.add(resolve));
	}

	private release(entry: Attached, tellServer: boolean): void {
		entry.doc.off("update", entry.onUpdate);
		this.docs.delete(entry.docId);
		if (entry.remoteId) this.byRemote.delete(entry.remoteId);
		for (const w of entry.waiters) w(false);
		entry.waiters.clear();
		if (tellServer && this.isOpen() && entry.remoteId)
			this.send(encodeUnsubscribe(entry.remoteId));
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
		this.recompute();
	}

	/** Gives the doc its server name, once there is a key to make it with. */
	private bind(entry: Attached): boolean {
		const cipher = this.opts.cipher();
		if (!cipher) return false;
		const id = cipher.remoteId(entry.docId);
		if (id !== entry.remoteId) {
			// First bind, or the account or key changed since: what the old server held says
			// nothing about the new one, so read and upload the doc in full.
			if (entry.remoteId) this.byRemote.delete(entry.remoteId);
			if (entry.stateFor && entry.stateFor !== id) {
				entry.lastSeq = 0;
				entry.remoteSV = new Map();
				this.remember(entry);
			}
			entry.stateFor = id;
			entry.remoteId = id;
			this.byRemote.set(id, entry);
			this.remoteToLocal.set(id, entry.docId);
		}
		return true;
	}

	private subscribeDoc(entry: Attached): void {
		if (!this.bind(entry)) return;
		entry.handshaken = false;
		entry.queue = [];
		this.send(encodeSubscribe(entry.remoteId, entry.lastSeq));
	}

	/** Seals one update and sends it; it counts as pending until the server acknowledges it. */
	private push(entry: Attached, update: Uint8Array): void {
		const cipher = this.opts.cipher();
		if (!cipher) return;
		entry.queue.push(update);
		this.send(encodePush(entry.remoteId, cipher.seal(entry.docId, update)));
	}

	private remember(entry: Attached): void {
		if (!entry.saveState || entry.dirty) return;
		entry.dirty = true;
		queueMicrotask(() => {
			entry.dirty = false;
			entry.saveState?.({
				lastSeq: entry.lastSeq,
				remoteSV: Y.encodeStateVector(entry.remoteSV),
				remoteId: entry.remoteId,
			});
		});
	}

	private connect(): void {
		if (!this.running) return;
		if (!this.opts.cipher()) {
			// No key on this device yet: nothing could be sealed or opened.
			this.scheduleReconnect();
			return;
		}
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
		this.opened = false;

		socket.onopen = () => {
			if (this.socket !== socket) return;
			this.opened = true;
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

	/** Start over with every attached doc: ask the server for what we have not read yet. */
	private handshakeAll(): void {
		for (const e of this.docs.values()) this.subscribeDoc(e);
		this.sendDrops();
		this.recompute();
	}

	private onSocketGone(socket: SocketLike): void {
		if (this.socket !== socket) return;
		const neverOpened = !this.opened;
		this.dropSocket();
		this.scheduleReconnect();
		if (neverOpened) this.opts.onConnectFailed?.();
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
			e.queue = [];
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
			const local = this.remoteToLocal.get(frame.docId);
			if (local) for (const l of this.notifyListeners) l(local);
			return;
		}
		const entry = this.byRemote.get(frame.docId);
		if (!entry) return;

		if (frame.kind === FrameKind.Entry) {
			this.applyEntry(entry, frame.seq, frame.blob);
		} else if (frame.kind === FrameKind.Ready) {
			this.ready(entry, frame.head, frame.count);
		} else if (frame.kind === FrameKind.Ack) {
			const sent = entry.queue.shift();
			if (sent) mergeSV(entry.remoteSV, sent);
			this.remember(entry);
		}
		this.settle(entry);
		this.recompute();
	}

	private applyEntry(entry: Attached, seq: number, blob: Uint8Array): void {
		if (seq <= entry.lastSeq) return; // a snapshot or entry we already hold
		const cipher = this.opts.cipher();
		if (!cipher) return;
		try {
			const update = cipher.open(entry.docId, blob);
			Y.applyUpdate(entry.doc, update, this);
			mergeSV(entry.remoteSV, update);
			entry.lastSeq = seq;
			this.remember(entry);
		} catch (err) {
			// Wrong key, or the server handed back something altered. Never apply it.
			console.error("[sync] could not open an entry from the server", err);
		}
	}

	/** The server has sent everything it held: upload what it lacks, and tidy a long log. */
	private ready(entry: Attached, head: number, count: number): void {
		if (head < entry.lastSeq || (head === 0 && entry.remoteSV.size > 0)) {
			// The server holds less than we know it had: its data was reset. Start over from nothing.
			entry.lastSeq = 0;
			entry.remoteSV = new Map();
			this.remember(entry);
			this.subscribeDoc(entry);
			return;
		}
		const missing = Y.encodeStateAsUpdate(
			entry.doc,
			Y.encodeStateVector(entry.remoteSV),
		);
		if (missing.length > 2) this.push(entry, missing);
		entry.handshaken = true;
		if (count > COMPACT_AFTER && entry.lastSeq === head) {
			const cipher = this.opts.cipher();
			if (cipher)
				this.send(
					encodeSnapshot(
						entry.remoteId,
						head,
						cipher.seal(entry.docId, Y.encodeStateAsUpdate(entry.doc)),
					),
				);
		}
	}

	private settle(entry: Attached): void {
		if (entry.handshaken && entry.queue.length === 0) {
			for (const w of entry.waiters) w(true);
			entry.waiters.clear();
		}
	}

	private recompute(): void {
		let pending = 0;
		let waiting = false;
		for (const e of this.docs.values()) {
			if (e.quiet) continue;
			pending += e.queue.length;
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
