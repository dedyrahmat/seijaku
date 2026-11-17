import {
	type Attachment,
	type DocSyncState,
	fragmentText,
	INDEX_DOC_ID,
	isValidLocalDocId,
	listNotes,
	NOTE_FRAGMENT,
	type NoteMeta,
	noteDocId,
	SyncClient,
} from "@seijaku/sync";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { authStore } from "../auth/session";
import { getPrefs } from "../preferences";
import { currentSyncUrl } from "./syncUrl";

export interface NoteSession {
	id: string;
	doc: Y.Doc;
	fragment: Y.XmlFragment;
	/** Resolves once the note's content has been loaded from IndexedDB. */
	ready: Promise<void>;
}

interface Held extends NoteSession {
	persistence: IndexeddbPersistence;
	attachment: Attachment | null;
	/** Fetched in the background for offline use; dropped from memory once synced. */
	transient: boolean;
	released: boolean;
}

/** How many background notes are fetched at once after connecting. */
const CATCH_UP_PARALLEL = 4;

/**
 * Local-first workspace: the index doc and every note doc persist to IndexedDB, and one
 * WebSocket mirrors them to the server. Nothing here waits on the network; a dropped
 * connection only changes the status shown in the title bar.
 */
class Workspace {
	readonly index = new Y.Doc();
	readonly ready: Promise<void>;
	readonly sync = new SyncClient({
		url: currentSyncUrl,
		cipher: () => authStore.getCipher(),
		// A refused sign-in looks like a socket that never opened: ask the server who we are.
		onConnectFailed: () => void authStore.refresh(),
	});
	private attached = false;
	private sessions = new Map<string, Held>();
	private snapshot: NoteMeta[] = [];
	private listeners = new Set<() => void>();
	private indexAttachment: Attachment | null = null;

	/** Whether the browser agreed to keep our data under storage pressure; null while asking. */
	persisted: boolean | null = null;
	private persistedListeners = new Set<() => void>();

	/** Notes already mirrored from the server on this connection. */
	private caughtUp = new Set<string>();
	private catchUpTimer: ReturnType<typeof setTimeout> | null = null;
	private catchingUp = false;

	constructor() {
		const persistence = new IndexeddbPersistence("seijaku-index", this.index);
		this.index.on("update", () => {
			this.snapshot = listNotes(this.index);
			for (const n of this.snapshot) this.sync.learn(noteDocId(n.id));
			for (const l of this.listeners) l();
			this.scheduleCatchUp();
		});
		this.ready = persistence.whenSynced.then(() => {
			this.snapshot = listNotes(this.index);
			// Join the server only after local data is loaded, so the handshake sends one diff.
			this.attached = true;
			return this.attachDoc(INDEX_DOC_ID, this.index, persistence, false).then(
				(a) => {
					this.indexAttachment = a;
					this.applyAuth();
				},
			);
		});

		authStore.subscribe(() => this.applyAuth());

		// Ask the browser not to evict our data under storage pressure (matters most on iOS).
		const asked = navigator.storage?.persist?.() ?? Promise.resolve(false);
		asked
			.catch(() => false)
			.then((granted) => {
				this.persisted = granted;
				for (const l of this.persistedListeners) l();
			});

		let wasOffline = true;
		this.sync.subscribe(() => {
			const offline = this.sync.getState().status === "offline";
			if (wasOffline && !offline) this.caughtUp.clear();
			wasOffline = offline;
			if (!offline) this.scheduleCatchUp();
		});
		this.sync.onNotify((docId) => {
			if (!docId.startsWith("note-")) return;
			// Another device changed a note we are not watching: fetch it so it is ready offline.
			this.caughtUp.delete(docId.slice("note-".length));
			this.scheduleCatchUp();
		});

		// Do not wait out the backoff when the network or the tab comes back.
		window.addEventListener("online", () => this.sync.reconnectNow());
		document.addEventListener("visibilitychange", () => {
			if (document.visibilityState === "visible") this.sync.reconnectNow();
		});
	}

	/** Sync runs only while this device is signed in; signing out drops the connection. */
	/**
	 * Joins a doc to the sync client, remembering how far into the server's log it has read
	 * so a reload does not transfer the whole doc again.
	 */
	private async attachDoc(
		docId: string,
		doc: Y.Doc,
		persistence: IndexeddbPersistence,
		quiet: boolean,
	): Promise<Attachment> {
		const saved = (await persistence.get("sync").catch(() => null)) as
			| DocSyncState
			| null
			| undefined;
		return this.sync.attach(docId, doc, {
			quiet,
			state: saved ?? null,
			onState: (state) => void persistence.set("sync", state as never),
		});
	}

	private applyAuth(): void {
		if (!this.attached) return;
		if (authStore.getState().phase === "signed-in") {
			for (const n of this.snapshot) this.sync.learn(noteDocId(n.id));
			if (!getPrefs().workOffline) this.sync.start();
		} else if (authStore.getState().phase !== "checking") {
			this.sync.stop();
		}
	}

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	subscribePersisted = (listener: () => void): (() => void) => {
		this.persistedListeners.add(listener);
		return () => this.persistedListeners.delete(listener);
	};

	getPersisted = (): boolean | null => this.persisted;

	/** Stable reference between index changes, as useSyncExternalStore requires. */
	getNotes = (): NoteMeta[] => this.snapshot;

	/** Plain text of a note, from memory if it is open, otherwise read from IndexedDB. */
	async readText(id: string): Promise<string> {
		const open = this.sessions.get(id);
		if (open) {
			await open.ready;
			return fragmentText(open.fragment);
		}
		const doc = new Y.Doc();
		const persistence = new IndexeddbPersistence(`seijaku-note-${id}`, doc);
		try {
			await persistence.whenSynced;
			return fragmentText(doc.getXmlFragment(NOTE_FRAGMENT));
		} finally {
			void persistence.destroy();
			doc.destroy();
		}
	}

	/** Opens a note for editing. Stays loaded for the rest of the session. */
	openNote(id: string): NoteSession {
		const existing = this.sessions.get(id);
		if (existing) {
			if (existing.transient) {
				// The editor now needs it: show its edits in the status like any open note.
				existing.transient = false;
				if (existing.attachment) {
					existing.attachment.detach();
					existing.attachment = null;
					void this.attachDoc(
						noteDocId(id),
						existing.doc,
						existing.persistence,
						false,
					).then((a) => {
						if (existing.released) a.detach();
						else existing.attachment = a;
					});
				}
			}
			return existing;
		}
		return this.load(id, false);
	}

	private load(id: string, transient: boolean): Held {
		const doc = new Y.Doc();
		const persistence = new IndexeddbPersistence(`seijaku-note-${id}`, doc);
		const held: Held = {
			id,
			doc,
			fragment: doc.getXmlFragment(NOTE_FRAGMENT),
			persistence,
			attachment: null,
			transient,
			released: false,
			ready: persistence.whenSynced.then(async () => {
				if (held.released) return;
				const a = await this.attachDoc(
					noteDocId(id),
					doc,
					persistence,
					held.transient,
				);
				if (held.released) a.detach();
				else held.attachment = a;
			}),
		};
		this.sessions.set(id, held);
		return held;
	}

	private release(held: Held): void {
		held.released = true;
		held.attachment?.detach();
		void held.persistence.destroy();
		held.doc.destroy();
		this.sessions.delete(held.id);
	}

	/** Notes that exist in the index but are not yet mirrored on this connection. */
	private wanted(): string[] {
		return listNotes(this.index)
			.map((n) => n.id)
			.filter(
				(id) =>
					isValidLocalDocId(noteDocId(id)) &&
					!this.caughtUp.has(id) &&
					!this.sessions.has(id),
			);
	}

	private scheduleCatchUp(): void {
		if (this.catchUpTimer) return;
		this.catchUpTimer = setTimeout(() => {
			this.catchUpTimer = null;
			void this.catchUp();
		}, 400);
	}

	/**
	 * Mirrors every note from the server into IndexedDB so the whole workspace works offline,
	 * not just the notes opened on this device. Runs after each (re)connect and when other
	 * devices change notes this one is not watching.
	 */
	private async catchUp(): Promise<void> {
		if (this.catchingUp || this.sync.getState().status === "offline") return;
		this.catchingUp = true;
		try {
			// Wait for the index to match the server so notes made elsewhere are included.
			if (!(await this.indexAttachment?.whenSynced())) return;
			const queue = this.wanted();
			const worker = async () => {
				for (let id = queue.shift(); id; id = queue.shift()) {
					const held = this.load(id, true);
					await held.ready;
					const ok = await held.attachment?.whenSynced();
					if (ok) this.caughtUp.add(id);
					if (held.transient) this.release(held);
					if (!ok) return; // connection dropped; the next connect starts over
				}
			};
			await Promise.all(
				Array.from({ length: CATCH_UP_PARALLEL }, () => worker()),
			);
		} finally {
			this.catchingUp = false;
			// Anything that changed while we were busy gets its own pass.
			if (this.wanted().length > 0 && this.sync.getState().status !== "offline")
				this.scheduleCatchUp();
		}
	}
}

export const workspace = new Workspace();
