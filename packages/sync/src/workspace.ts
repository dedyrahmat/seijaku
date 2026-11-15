import * as Y from "yjs";

/**
 * The workspace "index doc": one Y.Doc holding the note tree.
 * Each note is a nested Y.Map so concurrent edits to different fields
 * (rename on one device, move on another) both survive the merge.
 * Note *content* lives in a separate Y.Doc per note (see NOTE_FRAGMENT).
 */

export const NOTES_KEY = "notes";
/** Name of the Y.XmlFragment holding editor content inside a note doc. */
export const NOTE_FRAGMENT = "blocknote";

export interface NoteMeta {
	id: string;
	title: string;
	parentId: string | null;
	/** Position among siblings; lower comes first. Ties break by id. */
	order: number;
	icon: string | null;
	tags: string[];
	trashed: boolean;
	createdAt: number;
	updatedAt: number;
}

export interface TreeNode {
	note: NoteMeta;
	children: TreeNode[];
}

type NoteMap = Y.Map<unknown>;

function notesMap(doc: Y.Doc): Y.Map<NoteMap> {
	return doc.getMap<NoteMap>(NOTES_KEY);
}

/** 20 hex chars from the platform CSPRNG. Works outside secure contexts, unlike crypto.randomUUID. */
export function newId(): string {
	const bytes = new Uint8Array(10);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function readNote(id: string, m: NoteMap): NoteMeta {
	const tags = m.get("tags");
	return {
		id,
		title: (m.get("title") as string | undefined) ?? "",
		parentId: (m.get("parentId") as string | null | undefined) ?? null,
		order: (m.get("order") as number | undefined) ?? 0,
		icon: (m.get("icon") as string | null | undefined) ?? null,
		tags: Array.isArray(tags) ? (tags as string[]) : [],
		trashed: (m.get("trashed") as boolean | undefined) ?? false,
		createdAt: (m.get("createdAt") as number | undefined) ?? 0,
		updatedAt: (m.get("updatedAt") as number | undefined) ?? 0,
	};
}

export function getNote(doc: Y.Doc, id: string): NoteMeta | undefined {
	const m = notesMap(doc).get(id);
	return m ? readNote(id, m) : undefined;
}

export function listNotes(doc: Y.Doc): NoteMeta[] {
	const out: NoteMeta[] = [];
	notesMap(doc).forEach((m, id) => {
		out.push(readNote(id, m));
	});
	return out;
}

function compareNotes(a: NoteMeta, b: NoteMeta): number {
	return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Visible (not trashed) children of `parentId`, in display order. */
export function siblingsOf(
	notes: NoteMeta[],
	parentId: string | null,
): NoteMeta[] {
	return notes
		.filter((n) => !n.trashed && n.parentId === parentId)
		.sort(compareNotes);
}

function siblings(doc: Y.Doc, parentId: string | null): NoteMeta[] {
	return siblingsOf(listNotes(doc), parentId);
}

export interface CreateNoteInput {
	/** Supply a deterministic id (e.g. daily notes). Existing ids are left untouched. */
	id?: string;
	title?: string;
	parentId?: string | null;
	icon?: string | null;
	tags?: string[];
	now?: number;
}

/** Creates a note at the end of its siblings. Idempotent for a given `id`. */
export function createNote(doc: Y.Doc, input: CreateNoteInput = {}): string {
	const id = input.id ?? newId();
	const notes = notesMap(doc);
	if (notes.has(id)) return id;
	const parentId = input.parentId ?? null;
	const now = input.now ?? Date.now();
	doc.transact(() => {
		const last = siblings(doc, parentId).at(-1);
		const m: NoteMap = new Y.Map();
		notes.set(id, m);
		m.set("title", input.title ?? "");
		m.set("parentId", parentId);
		m.set("order", last ? last.order + 1 : 1);
		m.set("icon", input.icon ?? null);
		m.set("tags", input.tags ?? []);
		m.set("trashed", false);
		m.set("createdAt", now);
		m.set("updatedAt", now);
	});
	return id;
}

export type NotePatch = Partial<Pick<NoteMeta, "title" | "icon" | "tags">>;

export function updateNote(
	doc: Y.Doc,
	id: string,
	patch: NotePatch,
	now = Date.now(),
): void {
	const m = notesMap(doc).get(id);
	if (!m) return;
	doc.transact(() => {
		for (const [key, value] of Object.entries(patch)) {
			if (value !== undefined) m.set(key, value);
		}
		m.set("updatedAt", now);
	});
}

/** Bump `updatedAt` after a content edit. */
export function touchNote(doc: Y.Doc, id: string, now = Date.now()): void {
	notesMap(doc).get(id)?.set("updatedAt", now);
}

function isDescendant(
	notes: NoteMeta[],
	ancestorId: string,
	candidateId: string,
): boolean {
	const byId = new Map(notes.map((n) => [n.id, n]));
	const seen = new Set<string>();
	let cur = byId.get(candidateId);
	while (cur && !seen.has(cur.id)) {
		if (cur.parentId === ancestorId) return true;
		seen.add(cur.id);
		cur = cur.parentId ? byId.get(cur.parentId) : undefined;
	}
	return false;
}

/**
 * Move a note under `parentId` (null = root), placed before `beforeId`
 * or at the end when `beforeId` is null. Refuses moves that would create a cycle.
 * Returns false when the move was rejected.
 */
export function moveNote(
	doc: Y.Doc,
	id: string,
	parentId: string | null,
	beforeId: string | null = null,
	now = Date.now(),
): boolean {
	const m = notesMap(doc).get(id);
	if (!m) return false;
	if (parentId === id) return false;
	if (parentId && isDescendant(listNotes(doc), id, parentId)) return false;

	doc.transact(() => {
		let sibs = siblings(doc, parentId).filter((n) => n.id !== id);
		const beforeIdx = beforeId ? sibs.findIndex((n) => n.id === beforeId) : -1;
		const next = beforeIdx >= 0 ? sibs[beforeIdx] : undefined;
		const prev = beforeIdx >= 0 ? sibs[beforeIdx - 1] : sibs.at(-1);

		// Gaps shrink by half on every insert at the same spot; renumber before float precision runs out.
		if (next && prev && next.order - prev.order < 1e-6) {
			sibs.forEach((n, i) => {
				notesMap(doc)
					.get(n.id)
					?.set("order", i + 1);
			});
			sibs = siblings(doc, parentId).filter((n) => n.id !== id);
		}
		const nextR = beforeIdx >= 0 ? sibs[beforeIdx] : undefined;
		const prevR = beforeIdx >= 0 ? sibs[beforeIdx - 1] : sibs.at(-1);

		let order: number;
		if (nextR && prevR) order = (prevR.order + nextR.order) / 2;
		else if (nextR) order = nextR.order - 1;
		else if (prevR) order = prevR.order + 1;
		else order = 1;

		m.set("parentId", parentId);
		m.set("order", order);
		m.set("updatedAt", now);
	});
	return true;
}

export type Nudge = "up" | "down" | "indent" | "outdent";

/**
 * Keyboard/touch-friendly alternative to drag and drop.
 * Returns false when the move is not possible (e.g. first item cannot move up).
 */
export function nudgeNote(doc: Y.Doc, id: string, dir: Nudge): boolean {
	const notes = listNotes(doc);
	const note = notes.find((n) => n.id === id);
	if (!note) return false;
	const sibs = siblingsOf(notes, note.parentId);
	const i = sibs.findIndex((n) => n.id === id);
	if (i < 0) return false;

	switch (dir) {
		case "up": {
			const prev = sibs[i - 1];
			return prev ? moveNote(doc, id, note.parentId, prev.id) : false;
		}
		case "down": {
			if (i >= sibs.length - 1) return false;
			return moveNote(doc, id, note.parentId, sibs[i + 2]?.id ?? null);
		}
		case "indent": {
			const prev = sibs[i - 1];
			return prev ? moveNote(doc, id, prev.id, null) : false;
		}
		case "outdent": {
			const parent = note.parentId
				? notes.find((n) => n.id === note.parentId)
				: undefined;
			if (!parent) return false;
			const uncles = siblingsOf(notes, parent.parentId);
			const pi = uncles.findIndex((n) => n.id === parent.id);
			return moveNote(doc, id, parent.parentId, uncles[pi + 1]?.id ?? null);
		}
	}
}

/** Soft delete. Descendants stay attached and are hidden with their parent. */
export function trashNote(doc: Y.Doc, id: string, now = Date.now()): void {
	const m = notesMap(doc).get(id);
	if (!m) return;
	doc.transact(() => {
		m.set("trashed", true);
		m.set("updatedAt", now);
	});
}

export function restoreNote(doc: Y.Doc, id: string, now = Date.now()): void {
	const m = notesMap(doc).get(id);
	if (!m) return;
	doc.transact(() => {
		m.set("trashed", false);
		m.set("updatedAt", now);
	});
}

/**
 * Build the visible tree. A note is hidden when it, or any ancestor, is trashed.
 * Notes whose parent no longer exists, or that sit in a cycle created by
 * concurrent moves on different devices, are shown at the root instead of vanishing.
 */
export function buildTree(notes: NoteMeta[]): TreeNode[] {
	const byId = new Map(notes.map((n) => [n.id, n]));

	const effectiveParent = (n: NoteMeta): string | null => {
		if (n.parentId === null || !byId.has(n.parentId)) return null;
		const seen = new Set<string>([n.id]);
		let cur: NoteMeta | undefined = byId.get(n.parentId);
		while (cur) {
			if (seen.has(cur.id)) return null; // cycle: surface at root
			seen.add(cur.id);
			cur = cur.parentId ? byId.get(cur.parentId) : undefined;
		}
		return n.parentId;
	};

	const hidden = (n: NoteMeta): boolean => {
		const seen = new Set<string>();
		let cur: NoteMeta | undefined = n;
		while (cur && !seen.has(cur.id)) {
			if (cur.trashed) return true;
			seen.add(cur.id);
			const p: string | null = effectiveParent(cur);
			cur = p ? byId.get(p) : undefined;
		}
		return false;
	};

	const children = new Map<string | null, NoteMeta[]>();
	for (const n of notes) {
		if (hidden(n)) continue;
		const p = effectiveParent(n);
		const list = children.get(p);
		if (list) list.push(n);
		else children.set(p, [n]);
	}

	const build = (parent: string | null): TreeNode[] =>
		(children.get(parent) ?? [])
			.sort(compareNotes)
			.map((note) => ({ note, children: build(note.id) }));
	return build(null);
}

/** Notes the user trashed directly (not those hidden only because an ancestor was trashed). */
export function listTrash(notes: NoteMeta[]): NoteMeta[] {
	const byId = new Map(notes.map((n) => [n.id, n]));
	return notes
		.filter((n) => n.trashed && !(n.parentId && byId.get(n.parentId)?.trashed))
		.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function flattenTree(tree: TreeNode[]): NoteMeta[] {
	const out: NoteMeta[] = [];
	const walk = (nodes: TreeNode[]) => {
		for (const n of nodes) {
			out.push(n.note);
			walk(n.children);
		}
	};
	walk(tree);
	return out;
}

/** Deletes a trashed page and everything beneath it for good. Returns the removed ids. */
export function purgeNote(doc: Y.Doc, id: string): string[] {
	const notes = notesMap(doc);
	const all = listNotes(doc);
	const doomed = new Set<string>([id]);
	let grew = true;
	while (grew) {
		grew = false;
		for (const n of all) {
			if (n.parentId && doomed.has(n.parentId) && !doomed.has(n.id)) {
				doomed.add(n.id);
				grew = true;
			}
		}
	}
	doc.transact(() => {
		for (const d of doomed) notes.delete(d);
	});
	return [...doomed].filter((d) => !notes.has(d));
}

/** Every trashed note that is not itself inside another trashed note's subtree is a trash entry. */
export function purgeAllTrashed(doc: Y.Doc): string[] {
	const removed: string[] = [];
	for (const n of listTrash(listNotes(doc))) {
		if (getNote(doc, n.id)) removed.push(...purgeNote(doc, n.id));
	}
	return removed;
}

/** `daily-2026-11-15`: the same id on every device, so offline devices converge on one note. */
export function dailyNoteId(date: Date): string {
	const p = (n: number) => String(n).padStart(2, "0");
	return `daily-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function isDailyNoteId(id: string): boolean {
	return /^daily-\d{4}-\d{2}-\d{2}$/.test(id);
}

/** "Sun 15 Nov", as in the design. */
export function dailyTitle(date: Date): string {
	return date.toLocaleDateString("en-GB", {
		weekday: "short",
		day: "numeric",
		month: "short",
	});
}

/** Opens (creating if needed) the daily note for `date` and returns its id. */
export function ensureDailyNote(doc: Y.Doc, date: Date): string {
	const id = dailyNoteId(date);
	const existing = getNote(doc, id);
	if (!existing) createNote(doc, { id, title: dailyTitle(date) });
	else if (existing.trashed) restoreNote(doc, id);
	return id;
}

/** All tags in use on live notes with their counts, most used first. */
export function listTags(notes: NoteMeta[]): { tag: string; count: number }[] {
	const counts = new Map<string, number>();
	for (const n of notes) {
		if (n.trashed) continue;
		for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
	}
	return [...counts]
		.map(([tag, count]) => ({ tag, count }))
		.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Tags are lowercase words without spaces or a leading #. */
export function normalizeTag(raw: string): string {
	return raw.trim().replace(/^#+/, "").replace(/\s+/g, "-").toLowerCase();
}
