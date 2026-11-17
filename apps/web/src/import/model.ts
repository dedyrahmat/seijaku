/**
 * The common shape every importer produces. An importer only reads an export and describes
 * notes in this form; one shared writer (writer.ts) then makes the pages, uploads the files
 * and fills in the content. Nothing here touches the workspace, so importers are plain
 * functions that can be tested without a browser.
 */

export interface ImportedFile {
	name: string;
	type: string;
	bytes: Uint8Array;
}

export interface ImportedNote {
	/** Where it came from, as shown in the progress list: "Studies/Signals/Fourier.md". */
	source: string;
	/** Titles of the pages it nests under, outermost first. */
	parents: string[];
	title: string;
	tags: string[];
	createdAt?: number;
	updatedAt?: number;
	body: { kind: "markdown" | "html" | "text"; text: string };
	/** Files the body points at, keyed by the exact reference the importer wrote into it. */
	files: Record<string, ImportedFile>;
	/** Files that belong to the note but are not placed in the text; they are added at the end. */
	extras: ImportedFile[];
	/** Things that did not survive the move, shown next to the note. */
	warnings: string[];
}

export interface Skipped {
	source: string;
	reason: string;
}

export interface Parsed {
	notes: ImportedNote[];
	skipped: Skipped[];
}

/** Every file of an export by path (forward slashes, no leading slash), zips already opened. */
export type Entries = Map<string, Uint8Array>;

export function newNote(
	source: string,
	title: string,
	body: ImportedNote["body"],
): ImportedNote {
	return {
		source,
		parents: [],
		title,
		tags: [],
		body,
		files: {},
		extras: [],
		warnings: [],
	};
}

export const dirname = (path: string): string =>
	path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
export const basename = (path: string): string =>
	path.slice(path.lastIndexOf("/") + 1);
export const extname = (path: string): string => {
	const base = basename(path);
	const dot = base.lastIndexOf(".");
	return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
};
export const stem = (path: string): string => {
	const base = basename(path);
	const dot = base.lastIndexOf(".");
	return dot > 0 ? base.slice(0, dot) : base;
};

/** "a/b/../c.png" relative to "x/y" -> "x/y/a/c.png" (never above the root). */
export function resolvePath(from: string, ref: string): string {
	const parts = (ref.startsWith("/") ? ref.slice(1) : `${from}/${ref}`)
		.split("/")
		.filter(Boolean);
	const out: string[] = [];
	for (const p of parts) {
		if (p === ".") continue;
		if (p === "..") out.pop();
		else out.push(p);
	}
	return out.join("/");
}

const MIME: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	avif: "image/avif",
	svg: "image/svg+xml",
	heic: "image/heic",
	mp4: "video/mp4",
	webm: "video/webm",
	mov: "video/quicktime",
	mp3: "audio/mpeg",
	m4a: "audio/mp4",
	wav: "audio/wav",
	ogg: "audio/ogg",
	pdf: "application/pdf",
};

export function mimeFor(path: string): string {
	return MIME[extname(path)] ?? "application/octet-stream";
}

export const isImage = (type: string) => type.startsWith("image/");

/**
 * Hands out stable references for files, so a body can say `seijaku-file:3` instead of a path
 * that Markdown or HTML parsers would mangle (spaces, brackets, percent signs).
 */
export class FileRefs {
	private byPath = new Map<string, string>();
	constructor(
		private entries: Entries,
		private into: Record<string, ImportedFile>,
	) {}

	/** The reference for an entry, or null if the export has no such file. */
	ref(path: string): string | null {
		const known = this.byPath.get(path);
		if (known) return known;
		const bytes = this.entries.get(path);
		if (!bytes) return null;
		const ref = `seijaku-file:${Object.keys(this.into).length + 1}`;
		this.into[ref] = { name: basename(path), type: mimeFor(path), bytes };
		this.byPath.set(path, ref);
		return ref;
	}
}

/** Splits `---` frontmatter off a Markdown file. Understands the plain `key: value` and list forms. */
export function frontmatter(text: string): {
	data: Record<string, string | string[]>;
	body: string;
} {
	const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
	if (!m) return { data: {}, body: text };
	const data: Record<string, string | string[]> = {};
	let list: string | null = null;
	for (const line of (m[1] as string).split(/\r?\n/)) {
		const item = line.match(/^\s+-\s+(.*)$/);
		if (item && list) {
			(data[list] as string[]).push(unquote(item[1] as string));
			continue;
		}
		const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
		if (!kv) continue;
		const key = (kv[1] as string).toLowerCase();
		const value = (kv[2] as string).trim();
		if (value === "") {
			data[key] = [];
			list = key;
		} else if (value.startsWith("[") && value.endsWith("]")) {
			data[key] = value
				.slice(1, -1)
				.split(",")
				.map((v) => unquote(v))
				.filter(Boolean);
			list = null;
		} else {
			data[key] = unquote(value);
			list = null;
		}
	}
	return { data, body: text.slice(m[0].length) };
}

function unquote(v: string): string {
	return v.trim().replace(/^(["'])(.*)\1$/, "$2");
}

/** A time from a string like "2026-11-09", or undefined when it is not one. */
export function parseDate(text: unknown): number | undefined {
	if (typeof text !== "string" || !text.trim()) return undefined;
	const t = Date.parse(text.trim());
	return Number.isFinite(t) && t > 0 ? t : undefined;
}

/** Tags written as "a, b", "#a #b" or a list, cleaned to bare words. */
export function tagList(value: string | string[] | undefined): string[] {
	const raw = Array.isArray(value) ? value : (value ?? "").split(/[,\s]+/);
	return raw
		.map((t) => t.trim().replace(/^#+/, "").replace(/\s+/g, "-").toLowerCase())
		.filter(Boolean);
}
