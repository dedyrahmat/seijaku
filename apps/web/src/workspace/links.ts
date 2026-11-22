import { type FoundLink, fragmentLinks, type NoteMeta } from "@seijaku/sync";
import { useEffect, useMemo, useState } from "react";
import { workspace } from "./store";

/**
 * Which pages link to which, worked out on this device from the notes themselves (the server
 * only holds sealed text and never sees a link). Each note is read once per edit time and
 * kept for the session, like the text search reads.
 */
const found = new Map<string, { stamp: number; links: FoundLink[] }>();

export interface Backlink {
	from: NoteMeta;
	/** The line the link sits in. */
	text: string;
}

/** Pages that link to `noteId`, newest edit first. Fills in as the notes are read. */
export function useBacklinks(noteId: string, notes: NoteMeta[]): Backlink[] {
	const [version, bump] = useState(0);
	useEffect(() => {
		let live = true;
		const title = (id: string) => notes.find((n) => n.id === id)?.title ?? "";
		(async () => {
			let changed = false;
			for (const n of notes) {
				if (!live) return;
				if (n.trashed || found.get(n.id)?.stamp === n.updatedAt) continue;
				const links = await workspace
					.withFragment(n.id, (f) => fragmentLinks(f, title))
					.catch(() => []);
				found.set(n.id, { stamp: n.updatedAt, links });
				changed = true;
			}
			if (live && changed) bump((v) => v + 1);
		})();
		return () => {
			live = false;
		};
	}, [notes]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `version` marks new reads of the cache
	return useMemo(() => {
		const out: Backlink[] = [];
		for (const from of notes) {
			if (from.trashed || from.id === noteId) continue;
			for (const l of found.get(from.id)?.links ?? [])
				if (l.target === noteId) out.push({ from, text: l.text });
		}
		return out.sort((a, b) => b.from.updatedAt - a.from.updatedAt);
	}, [noteId, notes, version]);
}
