import {
	buildTree,
	countWords,
	fragmentText,
	getWorkspaceName,
	type NoteMeta,
	parsePageSlug,
	type SyncState,
	type TreeNode,
} from "@seijaku/sync";
import { useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { needsHomeScreenNotice, readStorageEnv } from "./storage";
import { type NoteSession, workspace } from "./store";

export function useWorkspaceReady(): boolean {
	const [ready, setReady] = useState(false);
	useEffect(() => {
		let live = true;
		workspace.ready.then(() => live && setReady(true));
		return () => {
			live = false;
		};
	}, []);
	return ready;
}

/** The id of the page in the URL (`/page/Some-Title-<id>`), if any. */
export function useNoteId(): string | undefined {
	const { slug } = useParams({ strict: false }) as { slug?: string };
	return slug ? parsePageSlug(slug) : undefined;
}

export function useNotes(): NoteMeta[] {
	return useSyncExternalStore(workspace.subscribe, workspace.getNotes);
}

/** The workspace's name (synced); "" until someone sets one. */
export function useWorkspaceName(): string {
	return useSyncExternalStore(workspace.subscribe, () =>
		getWorkspaceName(workspace.index),
	);
}

export function useTree(): TreeNode[] {
	const notes = useNotes();
	return useMemo(() => buildTree(notes), [notes]);
}

/** Loads a note's content doc; `null` until IndexedDB has been read. */
export function useNoteSession(id: string): NoteSession | null {
	const [loaded, setLoaded] = useState<NoteSession | null>(null);
	useEffect(() => {
		let live = true;
		setLoaded(null);
		const session = workspace.openNote(id);
		session.ready.then(() => live && setLoaded(session));
		return () => {
			live = false;
		};
	}, [id]);
	return loaded;
}

/** Per-device UI preference, safe when storage is blocked (private mode, etc). */
export function readLocal(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

export function writeLocal(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		// Storage unavailable: the preference simply won't persist.
	}
}

export function useSyncState(): SyncState {
	return useSyncExternalStore(
		workspace.sync.subscribe,
		workspace.sync.getState,
	);
}

/** True when the design's "Keep your notes safe" notice applies on this device. */
export function useHomeScreenNotice(): boolean {
	const persisted = useSyncExternalStore(
		workspace.subscribePersisted,
		workspace.getPersisted,
	);
	return needsHomeScreenNotice(readStorageEnv(persisted));
}

/** Words in a note, recounted shortly after the content stops changing. */
export function useWordCount(session: NoteSession | null): number {
	const [count, setCount] = useState(0);
	useEffect(() => {
		if (!session) return setCount(0);
		const recount = () => setCount(countWords(fragmentText(session.fragment)));
		recount();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const onChange = () => {
			clearTimeout(timer);
			timer = setTimeout(recount, 300);
		};
		session.fragment.observeDeep(onChange);
		return () => {
			clearTimeout(timer);
			session.fragment.unobserveDeep(onChange);
		};
	}, [session]);
	return count;
}
