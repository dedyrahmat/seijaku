import {
	buildTree,
	type NoteMeta,
	parsePageSlug,
	type TreeNode,
} from "@seijaku/sync";
import { useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
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
