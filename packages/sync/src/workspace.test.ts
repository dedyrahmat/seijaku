import { describe, expect, test } from "bun:test";
import * as Y from "yjs";
import {
	addToField,
	buildTree,
	changeKind,
	createNote,
	flattenTree,
	getNote,
	listNotes,
	listTrash,
	moveNote,
	nudgeNote,
	removeFromField,
	restoreNote,
	setField,
	trashNote,
	updateNote,
} from "./workspace";

const titles = (doc: Y.Doc) =>
	flattenTree(buildTree(listNotes(doc))).map((n) => n.title);

/** Two-way sync of two docs, as a server would relay it. */
function sync(a: Y.Doc, b: Y.Doc) {
	Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
	Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
}

describe("note tree", () => {
	test("creates notes in order, nested under parents", () => {
		const doc = new Y.Doc();
		const a = createNote(doc, { title: "A" });
		createNote(doc, { title: "B" });
		createNote(doc, { title: "A1", parentId: a });
		expect(titles(doc)).toEqual(["A", "A1", "B"]);
	});

	test("createNote is idempotent for a fixed id", () => {
		const doc = new Y.Doc();
		createNote(doc, { id: "daily-2026-11-15", title: "first" });
		createNote(doc, { id: "daily-2026-11-15", title: "second" });
		expect(listNotes(doc)).toHaveLength(1);
		expect(getNote(doc, "daily-2026-11-15")?.title).toBe("first");
	});

	test("moveNote reorders and re-parents", () => {
		const doc = new Y.Doc();
		const a = createNote(doc, { title: "A" });
		const b = createNote(doc, { title: "B" });
		const c = createNote(doc, { title: "C" });
		moveNote(doc, c, null, a);
		expect(titles(doc)).toEqual(["C", "A", "B"]);
		moveNote(doc, a, b);
		expect(titles(doc)).toEqual(["C", "B", "A"]);
		moveNote(doc, a, null, null);
		expect(titles(doc)).toEqual(["C", "B", "A"]);
	});

	test("moveNote refuses cycles and self-parenting", () => {
		const doc = new Y.Doc();
		const a = createNote(doc, { title: "A" });
		const b = createNote(doc, { title: "B", parentId: a });
		expect(moveNote(doc, a, b)).toBe(false);
		expect(moveNote(doc, a, a)).toBe(false);
		expect(getNote(doc, a)?.parentId).toBeNull();
	});

	test("repeated inserts at the same spot stay correctly ordered", () => {
		const doc = new Y.Doc();
		const first = createNote(doc, { title: "first" });
		const last = createNote(doc, { title: "last" });
		const ids: string[] = [];
		for (let i = 0; i < 60; i++) {
			const id = createNote(doc, { title: `n${i}` });
			moveNote(doc, id, null, last);
			ids.push(id);
		}
		const result = flattenTree(buildTree(listNotes(doc)));
		expect(result[0]?.id).toBe(first);
		expect(result.at(-1)?.id).toBe(last);
		expect(result.slice(1, -1).map((n) => n.id)).toEqual(ids);
	});
});

describe("nudgeNote", () => {
	test("up, down, indent and outdent", () => {
		const doc = new Y.Doc();
		const a = createNote(doc, { title: "A" });
		const b = createNote(doc, { title: "B" });
		const c = createNote(doc, { title: "C" });

		expect(nudgeNote(doc, a, "up")).toBe(false);
		expect(nudgeNote(doc, c, "down")).toBe(false);
		expect(nudgeNote(doc, a, "outdent")).toBe(false);

		expect(nudgeNote(doc, c, "up")).toBe(true);
		expect(titles(doc)).toEqual(["A", "C", "B"]);
		expect(nudgeNote(doc, a, "down")).toBe(true);
		expect(titles(doc)).toEqual(["C", "A", "B"]);

		expect(nudgeNote(doc, b, "indent")).toBe(true); // B under A
		expect(getNote(doc, b)?.parentId).toBe(a);
		expect(titles(doc)).toEqual(["C", "A", "B"]);

		expect(nudgeNote(doc, b, "outdent")).toBe(true); // back to root, after A
		expect(getNote(doc, b)?.parentId).toBeNull();
		expect(titles(doc)).toEqual(["C", "A", "B"]);
	});

	test("a daily note is never the page above, so the first page cannot move into it", () => {
		const doc = new Y.Doc();
		ensureDailyNote(doc, new Date(2026, 10, 19));
		const a = createNote(doc, { title: "A" });
		expect(nudgeNote(doc, a, "indent")).toBe(false);
		expect(nudgeNote(doc, a, "up")).toBe(false);
	});
});

describe("trash", () => {
	test("trashing hides the subtree; restoring brings it back", () => {
		const doc = new Y.Doc();
		const a = createNote(doc, { title: "A" });
		createNote(doc, { title: "A1", parentId: a });
		createNote(doc, { title: "B" });
		trashNote(doc, a);
		expect(titles(doc)).toEqual(["B"]);
		expect(listTrash(listNotes(doc)).map((n) => n.title)).toEqual(["A"]);
		restoreNote(doc, a);
		expect(titles(doc)).toEqual(["A", "A1", "B"]);
	});
});

describe("merging devices", () => {
	test("concurrent rename and move both survive", () => {
		const a = new Y.Doc();
		const b = new Y.Doc();
		const x = createNote(a, { title: "X" });
		const y = createNote(a, { title: "Y" });
		sync(a, b);

		updateNote(a, x, { title: "X renamed" });
		moveNote(b, x, y);
		sync(a, b);

		for (const doc of [a, b]) {
			expect(getNote(doc, x)?.title).toBe("X renamed");
			expect(getNote(doc, x)?.parentId).toBe(y);
		}
	});

	test("concurrent moves that form a cycle do not lose notes", () => {
		const a = new Y.Doc();
		const b = new Y.Doc();
		const x = createNote(a, { title: "X" });
		const y = createNote(a, { title: "Y" });
		sync(a, b);

		moveNote(a, x, y); // X under Y
		moveNote(b, y, x); // Y under X
		sync(a, b);

		const shownA = titles(a).sort();
		expect(shownA).toEqual(["X", "Y"]);
		expect(titles(b).sort()).toEqual(shownA);
	});

	test("same daily note created on two offline devices converges to one", () => {
		const a = new Y.Doc();
		const b = new Y.Doc();
		createNote(a, { id: "daily-2026-11-15", title: "Sun 15 Nov" });
		createNote(b, { id: "daily-2026-11-15", title: "Sun 15 Nov" });
		sync(a, b);
		expect(listNotes(a)).toHaveLength(1);
		expect(listNotes(b)).toHaveLength(1);
	});
});

import {
	dailyNoteId,
	ensureDailyNote,
	ensureJournalEntry,
	JOURNAL_ID,
	journalEntryId,
	listTags,
	normalizeTag,
	purgeAllTrashed,
	purgeExpired,
	purgeNote,
	setShare,
} from "./workspace";

describe("purge, daily notes and tags", () => {
	test("purging a page removes its whole subtree and nothing else", () => {
		const doc = new Y.Doc();
		const a = createNote(doc, { title: "a" });
		const b = createNote(doc, { title: "b", parentId: a });
		const c = createNote(doc, { title: "c", parentId: b });
		const keep = createNote(doc, { title: "keep" });
		trashNote(doc, a);
		expect(purgeNote(doc, a).sort()).toEqual([a, b, c].sort());
		expect(listNotes(doc).map((n) => n.id)).toEqual([keep]);
	});

	test("emptying the trash removes every trashed page", () => {
		const doc = new Y.Doc();
		const a = createNote(doc, {});
		const b = createNote(doc, {});
		const keep = createNote(doc, {});
		trashNote(doc, a);
		trashNote(doc, b);
		purgeAllTrashed(doc);
		expect(listNotes(doc).map((n) => n.id)).toEqual([keep]);
	});

	test("the daily note has one id per day on every device", () => {
		const day = new Date(2026, 10, 15);
		expect(dailyNoteId(day)).toBe("daily-2026-11-15");
		const a = new Y.Doc();
		const b = new Y.Doc();
		ensureDailyNote(a, day);
		ensureDailyNote(b, day);
		Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
		expect(listNotes(a).filter((n) => n.id === "daily-2026-11-15").length).toBe(
			1,
		);
		expect(listNotes(a)[0]?.title).toBe("Sun 15 Nov");
	});

	test("tags are counted over live notes and normalised", () => {
		const doc = new Y.Doc();
		createNote(doc, { tags: ["math", "signals"] });
		createNote(doc, { tags: ["math"] });
		const gone = createNote(doc, { tags: ["old"] });
		trashNote(doc, gone);
		expect(listTags(listNotes(doc))).toEqual([
			{ tag: "math", count: 2 },
			{ tag: "signals", count: 1 },
		]);
		expect(normalizeTag("  #Deep Work ")).toBe("deep-work");
	});
});

describe("trash expiry", () => {
	test("only entries older than the limit are deleted, and restoring clears the time", () => {
		const doc = new Y.Doc();
		const old = createNote(doc, { title: "old" });
		const fresh = createNote(doc, { title: "fresh" });
		const restored = createNote(doc, { title: "restored" });
		const day = 86_400_000;
		trashNote(doc, old, 1000);
		trashNote(doc, fresh, 1000 + 29 * day);
		trashNote(doc, restored, 1000);
		restoreNote(doc, restored, 1000 + 40 * day);
		expect(getNote(doc, restored)?.trashedAt).toBeNull();

		const removed = purgeExpired(doc, 30, 1000 + 31 * day);
		expect(removed).toEqual([old]);
		expect(getNote(doc, fresh)?.trashed).toBe(true);
		expect(getNote(doc, restored)).toBeDefined();
	});
});

test("a share record travels with the page and can be cleared", () => {
	const a = new Y.Doc();
	const id = createNote(a, { title: "shared" });
	expect(getNote(a, id)?.share).toBeNull();
	setShare(a, id, { token: "tok", key: "k", at: 5 });
	const b = new Y.Doc();
	Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
	expect(getNote(b, id)?.share).toEqual({ token: "tok", key: "k", at: 5 });
	setShare(b, id, null);
	expect(getNote(b, id)?.share).toBeNull();
});

describe("note kinds and the journal", () => {
	test("a note without a kind is a page; a chosen kind is kept", () => {
		const doc = new Y.Doc();
		const plain = createNote(doc, { title: "plain" });
		const list = createNote(doc, { title: "list", kind: "checklist" });
		expect(getNote(doc, plain)?.kind).toBe("page");
		expect(getNote(doc, list)?.kind).toBe("checklist");
	});

	test("an entry is filed under one Journal page, once per day", () => {
		const doc = new Y.Doc();
		const day = new Date(2026, 10, 19);
		const first = ensureJournalEntry(doc, day);
		expect(ensureJournalEntry(doc, day)).toBe(first);
		expect(first).toBe(journalEntryId(day));
		ensureJournalEntry(doc, new Date(2026, 10, 20));

		const notes = listNotes(doc);
		expect(notes.filter((n) => n.id === JOURNAL_ID)).toHaveLength(1);
		const entry = getNote(doc, first);
		expect(entry?.parentId).toBe(JOURNAL_ID);
		expect(entry?.kind).toBe("journal");
		expect(notes).toHaveLength(3);
	});

	test("a trashed entry comes back when its day is opened again", () => {
		const doc = new Y.Doc();
		const day = new Date(2026, 10, 19);
		const id = ensureJournalEntry(doc, day);
		trashNote(doc, JOURNAL_ID);
		trashNote(doc, id);
		ensureJournalEntry(doc, day);
		expect(getNote(doc, id)?.trashed).toBe(false);
		expect(getNote(doc, JOURNAL_ID)?.trashed).toBe(false);
	});

	test("two offline devices opening today's entry end up with one", () => {
		const a = new Y.Doc();
		const b = new Y.Doc();
		const day = new Date(2026, 10, 19);
		ensureJournalEntry(a, day);
		ensureJournalEntry(b, day);
		sync(a, b);
		expect(listNotes(a)).toHaveLength(2);
		expect(listNotes(b)).toHaveLength(2);
	});
});

describe("note kinds and fields", () => {
	test("changeKind switches type and refuses journal, daily and parents becoming quick", () => {
		const doc = new Y.Doc();
		const a = createNote(doc, { title: "A" });
		createNote(doc, { title: "child", parentId: a });
		expect(changeKind(doc, a, "meeting")).toBe(true);
		expect(getNote(doc, a)?.kind).toBe("meeting");
		expect(changeKind(doc, a, "quick")).toBe(false);
		expect(changeKind(doc, a, "journal")).toBe(false);
		expect(changeKind(doc, a, "page")).toBe(true);
		expect(getNote(doc, a)?.kind).toBe("page");
		const j = createNote(doc, { id: "journal-2026-11-19", kind: "journal" });
		expect(changeKind(doc, j, "page")).toBe(false);
		const d = createNote(doc, { id: "daily-2026-11-19" });
		expect(changeKind(doc, d, "study")).toBe(false);
	});

	test("fields survive a type change and back; old notes read as empty", () => {
		const doc = new Y.Doc();
		const id = createNote(doc, { kind: "meeting" });
		expect(getNote(doc, id)?.fields).toEqual({});
		setField(doc, id, "meeting", "place", "Room 4");
		changeKind(doc, id, "study");
		setField(doc, id, "study", "subject", "Biology");
		changeKind(doc, id, "meeting");
		expect(getNote(doc, id)?.fields).toEqual({
			meeting: { place: "Room 4" },
			study: { subject: "Biology" },
		});
		setField(doc, id, "meeting", "place", "");
		expect(getNote(doc, id)?.fields.meeting).toBeUndefined();
	});

	test("concurrent field edits and attendees merge", () => {
		const a = new Y.Doc();
		const id = createNote(a, { kind: "meeting" });
		const b = new Y.Doc();
		Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
		setField(a, id, "meeting", "place", "Zoom");
		setField(b, id, "meeting", "start", "10:00");
		addToField(a, id, "meeting", "attendees", "Aiko");
		addToField(b, id, "meeting", "attendees", "Ben");
		sync(a, b);
		const f = getNote(a, id)?.fields.meeting;
		expect(f?.place).toBe("Zoom");
		expect(f?.start).toBe("10:00");
		expect([...((f?.attendees ?? []) as string[])].sort()).toEqual([
			"Aiko",
			"Ben",
		]);
		removeFromField(a, id, "meeting", "attendees", "Aiko");
		expect(getNote(a, id)?.fields.meeting?.attendees).toEqual(["Ben"]);
	});
});
