import type { NoteMeta } from "./workspace";

export interface SearchHit {
	note: NoteMeta;
	/** Text around the first match in the body, split so the match can be highlighted. */
	snippet: { before: string; match: string; after: string } | null;
}

const CONTEXT = 48;

function snippetFor(text: string, terms: string[]): SearchHit["snippet"] {
	const lower = text.toLowerCase();
	let at = -1;
	let len = 0;
	for (const t of terms) {
		const i = lower.indexOf(t);
		if (i >= 0 && (at < 0 || i < at)) {
			at = i;
			len = t.length;
		}
	}
	if (at < 0) return null;
	const flat = (s: string) => s.replace(/\s+/g, " ");
	const start = Math.max(0, at - CONTEXT);
	const end = Math.min(text.length, at + len + CONTEXT);
	return {
		before: (start > 0 ? "…" : "") + flat(text.slice(start, at)),
		match: text.slice(at, at + len),
		after: flat(text.slice(at + len, end)) + (end < text.length ? "…" : ""),
	};
}

/**
 * On-device search over titles, tags and body text. Every word must appear somewhere;
 * title matches rank above body matches, then newer edits first. `#tag` lists a tag's notes.
 * An empty query returns the most recently edited notes.
 */
export function searchNotes(
	notes: NoteMeta[],
	textOf: (id: string) => string | undefined,
	query: string,
	limit = 20,
): SearchHit[] {
	const live = notes.filter((n) => !n.trashed);
	const q = query.trim().toLowerCase();
	const recent = (a: NoteMeta, b: NoteMeta) => b.updatedAt - a.updatedAt;

	if (!q) {
		return live
			.sort(recent)
			.slice(0, limit)
			.map((note) => ({ note, snippet: null }));
	}
	if (q.startsWith("#")) {
		const tag = q.slice(1);
		return live
			.filter((n) => n.tags.some((t) => t.startsWith(tag)))
			.sort(recent)
			.slice(0, limit)
			.map((note) => ({ note, snippet: null }));
	}

	const terms = q.split(/\s+/);
	const scored: { hit: SearchHit; score: number }[] = [];
	for (const note of live) {
		const title = note.title.toLowerCase();
		const body = textOf(note.id) ?? "";
		const bodyLower = body.toLowerCase();
		const tags = note.tags.join(" ");
		let score = 0;
		let all = true;
		for (const t of terms) {
			const inTitle = title.includes(t);
			const inBody = bodyLower.includes(t);
			if (!inTitle && !inBody && !tags.includes(t)) {
				all = false;
				break;
			}
			score += inTitle ? 3 : 0;
			score += inBody ? 1 : 0;
			if (title.startsWith(t)) score += 1;
		}
		if (all)
			scored.push({
				hit: { note, snippet: snippetFor(body, terms) },
				score,
			});
	}
	return scored
		.sort((a, b) => b.score - a.score || recent(a.hit.note, b.hit.note))
		.slice(0, limit)
		.map((s) => s.hit);
}
