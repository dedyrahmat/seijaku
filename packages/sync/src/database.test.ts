import { expect, test } from "bun:test";
import * as Y from "yjs";
import {
	addFilter,
	addOption,
	addProp,
	clearFilters,
	databaseRows,
	deleteProp,
	setCell,
	setHidden,
	setSort,
	TITLE_PROP,
} from "./database";
import {
	changeKind,
	createNote,
	getNote,
	listNotes,
	type NoteMeta,
} from "./workspace";

function setup() {
	const doc = new Y.Doc();
	const db = createNote(doc, { kind: "database", title: "Reading" });
	const status = addProp(doc, db, { name: "Status", type: "select" });
	const next = addOption(doc, db, status, "Next") as string;
	const reading = addOption(doc, db, status, "Reading") as string;
	const pages = addProp(doc, db, { name: "Pages", type: "number" });
	const started = addProp(doc, db, { name: "Started", type: "date" });
	const row = (title: string, cells: Record<string, string | number>) => {
		const id = createNote(doc, { parentId: db, title });
		for (const [k, v] of Object.entries(cells)) setCell(doc, id, k, v);
		return id;
	};
	return { doc, db, status, next, reading, pages, started, row };
}
const view = (doc: Y.Doc, db: string) => {
	const notes = listNotes(doc);
	const schema = (notes.find((n) => n.id === db) as NoteMeta).schema;
	if (!schema) throw new Error("no schema");
	return databaseRows(notes, db, schema);
};
const titles = (rows: NoteMeta[]) => rows.map((r) => r.title);

test("a database reads back its properties and options in order", () => {
	const { doc, db, status, next } = setup();
	const schema = getNote(doc, db)?.schema;
	expect(schema?.props.map((p) => p.name)).toEqual([
		"Status",
		"Pages",
		"Started",
	]);
	expect(schema?.props[0]?.options.map((o) => o.label)).toEqual([
		"Next",
		"Reading",
	]);
	expect(addOption(doc, db, status, "next")).toBe(next); // same label, same option
	expect(getNote(doc, createNote(doc))?.schema).toBeNull();
});

test("rows are the sub-pages, in page order, and trashed ones are left out", () => {
	const { doc, db, row } = setup();
	row("B", {});
	const a = row("A", {});
	expect(titles(view(doc, db).rows)).toEqual(["B", "A"]);
	doc.getMap<Y.Map<unknown>>("notes").get(a)?.set("trashed", true);
	expect(titles(view(doc, db).rows)).toEqual(["B"]);
});

test("sorting handles text, numbers and selects, and keeps empty cells last", () => {
	const { doc, db, status, next, reading, pages, row } = setup();
	row("Ink", { [pages]: 180, [status]: next });
	row("Tea", { [pages]: 20, [status]: reading });
	row("Void", {});
	setSort(doc, db, { prop: pages, dir: "asc" });
	expect(titles(view(doc, db).rows)).toEqual(["Tea", "Ink", "Void"]);
	setSort(doc, db, { prop: pages, dir: "desc" });
	expect(titles(view(doc, db).rows)).toEqual(["Ink", "Tea", "Void"]);
	setSort(doc, db, { prop: status, dir: "asc" }); // by option label: Next, Reading
	expect(titles(view(doc, db).rows)).toEqual(["Ink", "Tea", "Void"]);
	setSort(doc, db, { prop: TITLE_PROP, dir: "asc" });
	expect(titles(view(doc, db).rows)).toEqual(["Ink", "Tea", "Void"]);
	setSort(doc, db, null);
	expect(titles(view(doc, db).rows)).toEqual(["Ink", "Tea", "Void"]);
});

test("filters combine, and the count of hidden rows is reported", () => {
	const { doc, db, status, next, reading, pages, started, row } = setup();
	row("Ink", { [pages]: 180, [status]: next, [started]: "2026-11-01" });
	row("Tea", { [pages]: 20, [status]: reading, [started]: "2026-10-01" });
	row("Void", {});
	addFilter(doc, db, { prop: status, op: "isNot", value: next });
	expect(titles(view(doc, db).rows)).toEqual(["Tea", "Void"]);
	addFilter(doc, db, { prop: pages, op: "lt", value: 100 });
	expect(titles(view(doc, db).rows)).toEqual(["Tea"]);
	expect(view(doc, db).hidden).toBe(2);
	addFilter(doc, db, { prop: started, op: "after", value: "2026-10-15" });
	expect(titles(view(doc, db).rows)).toEqual([]);
	clearFilters(doc, db);
	expect(view(doc, db).rows).toHaveLength(3);
	addFilter(doc, db, { prop: TITLE_PROP, op: "contains", value: "te" });
	expect(titles(view(doc, db).rows)).toEqual(["Tea"]);
});

test("a checkbox cell filters, and false is stored as nothing", () => {
	const { doc, db } = setup();
	const own = addProp(doc, db, { name: "Owned", type: "checkbox" });
	const a = createNote(doc, { parentId: db, title: "A" });
	createNote(doc, { parentId: db, title: "B" });
	setCell(doc, a, own, true);
	addFilter(doc, db, { prop: own, op: "is", value: true });
	expect(titles(view(doc, db).rows)).toEqual(["A"]);
	setCell(doc, a, own, false);
	expect(getNote(doc, a)?.cells).toEqual({});
});

test("deleting a property drops its sort and filters but keeps the cells", () => {
	const { doc, db, pages, row } = setup();
	const id = row("Ink", { [pages]: 5 });
	setSort(doc, db, { prop: pages, dir: "asc" });
	addFilter(doc, db, { prop: pages, op: "gt", value: 1 });
	setHidden(doc, db, pages, true);
	deleteProp(doc, db, pages);
	const schema = getNote(doc, db)?.schema;
	expect(schema?.props.map((p) => p.name)).toEqual(["Status", "Started"]);
	expect(schema?.view).toEqual({ sort: null, filters: [], hidden: [] });
	expect(getNote(doc, id)?.cells[pages]).toBe(5);
});

test("two devices editing different cells, properties and filters all keep their work", () => {
	const { doc, db, pages, started, row } = setup();
	const id = row("Ink", {});
	const other = new Y.Doc();
	Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
	setCell(doc, id, pages, 10);
	setCell(other, id, started, "2026-11-02");
	addProp(other, db, { name: "Notes", type: "text" });
	addFilter(doc, db, { prop: pages, op: "gt", value: 1 });
	addFilter(other, db, { prop: pages, op: "lt", value: 99 });
	Y.applyUpdate(doc, Y.encodeStateAsUpdate(other));
	Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
	for (const d of [doc, other]) {
		expect(getNote(d, id)?.cells).toEqual({
			[pages]: 10,
			[started]: "2026-11-02",
		});
		expect(getNote(d, db)?.schema?.props).toHaveLength(4);
		expect(getNote(d, db)?.schema?.view.filters).toHaveLength(2);
	}
});

test("a database cannot be turned into another type, nor a page into a database", () => {
	const { doc, db } = setup();
	expect(changeKind(doc, db, "page")).toBe(false);
	expect(changeKind(doc, createNote(doc), "database")).toBe(false);
});
