import { listNotes, NOTE_FRAGMENT, type NoteMeta } from "@seijaku/sync";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";

export interface NoteSession {
	id: string;
	doc: Y.Doc;
	fragment: Y.XmlFragment;
	/** Resolves once the note's content has been loaded from IndexedDB. */
	ready: Promise<void>;
}

/**
 * Local-first workspace: the index doc and every note doc persist to IndexedDB.
 * Nothing here needs the network; sync (phase 3) attaches a provider to the same docs.
 */
class Workspace {
	readonly index = new Y.Doc();
	readonly ready: Promise<void>;
	private sessions = new Map<string, NoteSession>();
	private snapshot: NoteMeta[] = [];
	private listeners = new Set<() => void>();

	constructor() {
		const persistence = new IndexeddbPersistence("seijaku-index", this.index);
		this.index.on("update", () => {
			this.snapshot = listNotes(this.index);
			for (const l of this.listeners) l();
		});
		this.ready = persistence.whenSynced.then(() => {
			this.snapshot = listNotes(this.index);
		});
		// Ask the browser not to evict our data under storage pressure (matters most on iOS).
		void navigator.storage?.persist?.().catch(() => {});
	}

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	/** Stable reference between index changes, as useSyncExternalStore requires. */
	getNotes = (): NoteMeta[] => this.snapshot;

	openNote(id: string): NoteSession {
		const existing = this.sessions.get(id);
		if (existing) return existing;
		const doc = new Y.Doc();
		const persistence = new IndexeddbPersistence(`seijaku-note-${id}`, doc);
		const session: NoteSession = {
			id,
			doc,
			fragment: doc.getXmlFragment(NOTE_FRAGMENT),
			ready: persistence.whenSynced.then(() => {}),
		};
		this.sessions.set(id, session);
		return session;
	}
}

export const workspace = new Workspace();
