import { describe, expect, test } from "bun:test";
import * as Y from "yjs";
import { rangeBetween, withoutDescendants } from "./selection";
import { createNote, listNotes } from "./workspace";

describe("rangeBetween", () => {
	const order = ["a", "b", "c", "d", "e"];
	test("runs either way and includes both ends", () => {
		expect(rangeBetween(order, "b", "d")).toEqual(["b", "c", "d"]);
		expect(rangeBetween(order, "d", "b")).toEqual(["b", "c", "d"]);
	});
	test("one id, or an id that is not on screen, gives just the target", () => {
		expect(rangeBetween(order, "c", "c")).toEqual(["c"]);
		expect(rangeBetween(order, "x", "c")).toEqual(["c"]);
	});
});

describe("withoutDescendants", () => {
	test("keeps a parent and drops a child ticked with it", () => {
		const doc = new Y.Doc();
		const a = createNote(doc, { title: "A" });
		const a1 = createNote(doc, { title: "A1", parentId: a });
		const a11 = createNote(doc, { title: "A11", parentId: a1 });
		const b = createNote(doc, { title: "B" });
		expect(withoutDescendants(listNotes(doc), [a, a11, b])).toEqual([a, b]);
	});
	test("keeps a child whose parent is not in the set", () => {
		const doc = new Y.Doc();
		const a = createNote(doc, { title: "A" });
		const a1 = createNote(doc, { title: "A1", parentId: a });
		expect(withoutDescendants(listNotes(doc), [a1])).toEqual([a1]);
	});
});
