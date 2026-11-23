import type * as Y from "yjs";

/**
 * Databases: a page whose sub-pages are rows, with typed properties. Stored in the index doc
 * as flat keys on the note maps (never nested maps, so two devices writing first merge):
 *
 *   database note   p.<propId>            JSON of a property (name, type, options, order)
 *                   db.sort              { prop, dir }
 *                   db.filter#<stamp>    { prop, op, value }
 *                   db.hidden.<propId>   true
 *   row note        c.<propId>           the cell's value
 *
 * Deleting a property removes only its `p.` key; the cells stay, so a late edit from another
 * device cannot break anything. Which rows show, and in what order, is computed on the device.
 */

export const PROP_TYPES = [
	"text",
	"number",
	"select",
	"date",
	"checkbox",
] as const;
export type PropType = (typeof PROP_TYPES)[number];

/** The built-in first column; sorting and filtering by it uses this id. */
export const TITLE_PROP = "title";

export interface SelectOption {
	id: string;
	label: string;
	/** 0 to 5, one of the six tints. */
	tint: number;
}

export interface DbProp {
	id: string;
	name: string;
	type: PropType;
	options: SelectOption[];
	order: number;
}

export type Cell = string | number | boolean | null;

export const FILTER_OPS = [
	"contains",
	"is",
	"isNot",
	"eq",
	"gt",
	"lt",
	"before",
	"after",
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

/** Which operators make sense for which type, the first being the default. */
export const OPS_FOR: Record<PropType | "title", FilterOp[]> = {
	title: ["contains", "is"],
	text: ["contains", "is"],
	number: ["eq", "gt", "lt"],
	select: ["is", "isNot"],
	date: ["is", "before", "after"],
	checkbox: ["is"],
};

export interface DbFilter {
	/** The key it is stored under, so it can be removed. */
	id: string;
	prop: string;
	op: FilterOp;
	value: Cell;
}

export interface DbView {
	sort: { prop: string; dir: "asc" | "desc" } | null;
	filters: DbFilter[];
	hidden: string[];
}

export interface DbSchema {
	props: DbProp[];
	view: DbView;
}

type NoteMap = Y.Map<unknown>;

const P = "p.";
const C = "c.";
const SORT = "db.sort";
const FILTER = "db.filter#";
const HIDDEN = "db.hidden.";
const TINTS = 6;

function rid(): string {
	const bytes = new Uint8Array(5);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The note maps live under this key of the index doc (see workspace.ts). */
const noteMap = (doc: Y.Doc, id: string): NoteMap | undefined =>
	doc.getMap<NoteMap>("notes").get(id);

export function readCells(m: NoteMap): Record<string, Cell> {
	const out: Record<string, Cell> = {};
	m.forEach((value, key) => {
		if (key.startsWith(C)) out[key.slice(C.length)] = value as Cell;
	});
	return out;
}

export function readSchema(m: NoteMap): DbSchema {
	const props: DbProp[] = [];
	const filters: DbFilter[] = [];
	const hidden: string[] = [];
	let sort: DbView["sort"] = null;
	m.forEach((value, key) => {
		if (key.startsWith(P)) {
			const p = value as Partial<DbProp> | null;
			if (!p || typeof p !== "object") return;
			props.push({
				id: key.slice(P.length),
				name: String(p.name ?? ""),
				type: PROP_TYPES.includes(p.type as PropType)
					? (p.type as PropType)
					: "text",
				options: Array.isArray(p.options) ? p.options : [],
				order: Number(p.order ?? 0),
			});
		} else if (key === SORT) {
			sort = (value as DbView["sort"]) ?? null;
		} else if (key.startsWith(FILTER)) {
			filters.push({ ...(value as Omit<DbFilter, "id">), id: key });
		} else if (key.startsWith(HIDDEN) && value) {
			hidden.push(key.slice(HIDDEN.length));
		}
	});
	props.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
	filters.sort((a, b) => (a.id < b.id ? -1 : 1));
	return { props, view: { sort, filters, hidden } };
}

/** Adds a property at the end; a select starts with no options. Returns its id. */
export function addProp(
	doc: Y.Doc,
	dbId: string,
	input: { name: string; type: PropType; options?: SelectOption[] },
): string {
	const m = noteMap(doc, dbId);
	const id = rid();
	if (!m) return id;
	const last = readSchema(m).props.at(-1);
	m.set(`${P}${id}`, {
		name: input.name,
		type: input.type,
		options: input.options ?? [],
		order: last ? last.order + 1 : 1,
	});
	return id;
}

export function updateProp(
	doc: Y.Doc,
	dbId: string,
	propId: string,
	patch: Partial<Pick<DbProp, "name" | "options">>,
): void {
	const m = noteMap(doc, dbId);
	const cur = m?.get(`${P}${propId}`) as Record<string, unknown> | undefined;
	if (m && cur) m.set(`${P}${propId}`, { ...cur, ...patch });
}

/** Adds an option to a select property and returns its id (an existing label is reused). */
export function addOption(
	doc: Y.Doc,
	dbId: string,
	propId: string,
	label: string,
): string | null {
	const m = noteMap(doc, dbId);
	const prop = m && readSchema(m).props.find((p) => p.id === propId);
	const name = label.trim();
	if (!m || !prop || prop.type !== "select" || !name) return null;
	const same = prop.options.find(
		(o) => o.label.toLowerCase() === name.toLowerCase(),
	);
	if (same) return same.id;
	const id = rid();
	updateProp(doc, dbId, propId, {
		options: [
			...prop.options,
			{ id, label: name, tint: prop.options.length % TINTS },
		],
	});
	return id;
}

/** Removes a property from the table. Its values stay on the rows, unseen. */
export function deleteProp(doc: Y.Doc, dbId: string, propId: string): void {
	const m = noteMap(doc, dbId);
	if (!m) return;
	doc.transact(() => {
		m.delete(`${P}${propId}`);
		m.delete(`${HIDDEN}${propId}`);
		const { sort, filters } = readSchema(m).view;
		if (sort?.prop === propId) m.delete(SORT);
		for (const f of filters) if (f.prop === propId) m.delete(f.id);
	});
}

export function setCell(
	doc: Y.Doc,
	rowId: string,
	propId: string,
	value: Cell,
): void {
	const m = noteMap(doc, rowId);
	if (!m) return;
	if (value === null || value === "" || value === false)
		m.delete(`${C}${propId}`);
	else m.set(`${C}${propId}`, value);
}

export function setSort(doc: Y.Doc, dbId: string, sort: DbView["sort"]): void {
	const m = noteMap(doc, dbId);
	if (!m) return;
	if (sort) m.set(SORT, sort);
	else m.delete(SORT);
}

export function addFilter(
	doc: Y.Doc,
	dbId: string,
	filter: Omit<DbFilter, "id">,
): void {
	const stamp = `${Date.now().toString(36).padStart(9, "0")}${rid()}`;
	noteMap(doc, dbId)?.set(`${FILTER}${stamp}`, filter);
}

export function updateFilter(
	doc: Y.Doc,
	dbId: string,
	id: string,
	patch: Partial<Omit<DbFilter, "id">>,
): void {
	const m = noteMap(doc, dbId);
	const cur = m?.get(id) as Record<string, unknown> | undefined;
	if (m && cur && id.startsWith(FILTER)) m.set(id, { ...cur, ...patch });
}

export function removeFilter(doc: Y.Doc, dbId: string, id: string): void {
	if (id.startsWith(FILTER)) noteMap(doc, dbId)?.delete(id);
}

export function clearFilters(doc: Y.Doc, dbId: string): void {
	const m = noteMap(doc, dbId);
	if (!m) return;
	doc.transact(() => {
		for (const f of readSchema(m).view.filters) m.delete(f.id);
	});
}

export function setHidden(
	doc: Y.Doc,
	dbId: string,
	propId: string,
	hidden: boolean,
): void {
	const m = noteMap(doc, dbId);
	if (!m) return;
	if (hidden) m.set(`${HIDDEN}${propId}`, true);
	else m.delete(`${HIDDEN}${propId}`);
}

/** What `databaseRows` needs to know about a note. */
export interface RowLike {
	id: string;
	title: string;
	parentId: string | null;
	order: number;
	trashed: boolean;
	cells: Record<string, Cell>;
}

const isEmpty = (v: unknown) => v === undefined || v === null || v === "";

function matches(row: RowLike, f: DbFilter, schema: DbSchema): boolean {
	const prop = schema.props.find((p) => p.id === f.prop);
	if (f.prop !== TITLE_PROP && !prop) return true; // its property is gone
	const type = f.prop === TITLE_PROP ? "text" : (prop as DbProp).type;
	const raw = f.prop === TITLE_PROP ? row.title : row.cells[f.prop];
	if (type !== "checkbox" && isEmpty(f.value)) return true; // not filled in yet: filters nothing
	switch (type) {
		case "text": {
			const a = String(raw ?? "").toLowerCase();
			const b = String(f.value ?? "").toLowerCase();
			return f.op === "is" ? a === b : a.includes(b);
		}
		case "number": {
			if (isEmpty(raw) || isEmpty(f.value)) return false;
			const a = Number(raw);
			const b = Number(f.value);
			return f.op === "gt" ? a > b : f.op === "lt" ? a < b : a === b;
		}
		case "select": {
			const same = raw === f.value;
			return f.op === "isNot" ? !same : same;
		}
		case "date": {
			if (isEmpty(raw) || isEmpty(f.value)) return false;
			const a = String(raw);
			const b = String(f.value);
			return f.op === "before" ? a < b : f.op === "after" ? a > b : a === b;
		}
		case "checkbox":
			return Boolean(raw) === Boolean(f.value);
	}
}

function sortValue(
	r: RowLike,
	prop: string,
	schema: DbSchema,
): string | number | boolean | null {
	if (prop === TITLE_PROP) return r.title || null;
	const v = r.cells[prop];
	if (isEmpty(v)) return null;
	const p = schema.props.find((x) => x.id === prop);
	if (p?.type === "select")
		return p.options.find((o) => o.id === v)?.label ?? null;
	return v as string | number | boolean;
}

function compareValues(
	x: string | number | boolean,
	y: string | number | boolean,
): number {
	if (typeof x === "number" && typeof y === "number") return x - y;
	if (typeof x === "boolean" && typeof y === "boolean")
		return Number(x) - Number(y);
	return String(x).localeCompare(String(y));
}

/**
 * The rows to show: the database's sub-pages that pass every filter, sorted by the view (or
 * left in page order). `hidden` counts rows the filters removed.
 */
export function databaseRows<T extends RowLike>(
	notes: T[],
	dbId: string,
	schema: DbSchema,
): { rows: T[]; hidden: number } {
	const all = notes
		.filter((n) => n.parentId === dbId && !n.trashed)
		.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
	const rows = all.filter((r) =>
		schema.view.filters.every((f) => matches(r, f, schema)),
	);
	const { sort } = schema.view;
	if (sort) {
		const sign = sort.dir === "desc" ? -1 : 1;
		rows.sort((a, b) => {
			const x = sortValue(a, sort.prop, schema);
			const y = sortValue(b, sort.prop, schema);
			if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1; // empties last either way
			return compareValues(x, y) * sign;
		});
	}
	return { rows, hidden: all.length - rows.length };
}
