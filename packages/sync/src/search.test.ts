import { expect, test } from "bun:test";
import { searchNotes } from "./search";
import type { NoteMeta } from "./workspace";

function note(id: string, over: Partial<NoteMeta> = {}): NoteMeta {
	return {
		id,
		title: id,
		parentId: null,
		order: 0,
		icon: null,
		tags: [],
		trashed: false,
		trashedAt: null,
		share: null,
		createdAt: 0,
		updatedAt: 0,
		...over,
	};
}

const notes = [
	note("Fourier transforms", { updatedAt: 3, tags: ["math"] }),
	note("Linear algebra", { updatedAt: 2 }),
	note("Ramen", { updatedAt: 1 }),
	note("Old", { updatedAt: 9, trashed: true }),
];
const bodies: Record<string, string> = {
	"Fourier transforms":
		"Sweep the rate and you get the whole spectrum of the signal.",
	"Linear algebra": "the spectrum of a symmetric matrix is real",
	Ramen: "miso, noodles, egg",
	Old: "spectrum in the trash",
};
const text = (id: string) => bodies[id];

test("finds body text and returns a highlightable snippet", () => {
	const hits = searchNotes(notes, text, "spectrum");
	expect(hits.map((h) => h.note.id)).toEqual([
		"Fourier transforms",
		"Linear algebra",
	]);
	expect(hits[0]?.snippet?.match).toBe("spectrum");
	expect(hits[0]?.snippet?.before.length).toBeGreaterThan(0);
});

test("title matches outrank body matches and trash is never searched", () => {
	const hits = searchNotes(notes, text, "linear");
	expect(hits[0]?.note.id).toBe("Linear algebra");
	expect(searchNotes(notes, text, "trash")).toEqual([]);
});

test("every word must match, in any order", () => {
	expect(searchNotes(notes, text, "symmetric spectrum").length).toBe(1);
	expect(searchNotes(notes, text, "symmetric noodles").length).toBe(0);
});

test("#tag lists notes with that tag; empty query lists recent notes", () => {
	expect(searchNotes(notes, text, "#mat").map((h) => h.note.id)).toEqual([
		"Fourier transforms",
	]);
	expect(searchNotes(notes, text, "").map((h) => h.note.id)).toEqual([
		"Fourier transforms",
		"Linear algebra",
		"Ramen",
	]);
});
