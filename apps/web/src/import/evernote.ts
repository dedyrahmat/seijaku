import { md5 } from "@noble/hashes/legacy.js";
import { fromBase64 } from "@seijaku/sync";
import { text } from "./markdown";
import {
	type Entries,
	extname,
	type ImportedFile,
	type ImportedNote,
	newNote,
	type Parsed,
	stem,
} from "./model";

/**
 * Evernote .enex exports: an XML file per notebook holding every note, its tags, dates and
 * attachments ("resources") inline. A notebook becomes a parent page. The note body is ENML
 * (XHTML with <en-media> placeholders), which is turned into HTML and read like any other.
 * The format is regular, so the parts are read with patterns instead of an XML parser, which
 * keeps it testable without a browser.
 */

const ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
};

function decode(s: string): string {
	return s
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) =>
			String.fromCodePoint(Number.parseInt(n, 16)),
		)
		.replace(
			/&([a-z]+);/gi,
			(m, name: string) => ENTITIES[name.toLowerCase()] ?? m,
		);
}

const first = (src: string, tag: string): string | undefined =>
	src.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`))?.[1];

/** "20230102T030405Z" to milliseconds. */
function enexDate(s: string | undefined): number | undefined {
	const m = s?.trim().match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
	if (!m) return undefined;
	return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!);
}

const hex = (bytes: Uint8Array): string =>
	Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

interface Resource {
	file: ImportedFile;
	hash: string;
}

function resourcesOf(note: string): Resource[] {
	const out: Resource[] = [];
	for (const m of note.matchAll(/<resource>([\s\S]*?)<\/resource>/g)) {
		const body = m[1] as string;
		const data = first(body, "data");
		if (!data) continue;
		let bytes: Uint8Array;
		try {
			bytes = fromBase64(
				data
					.replace(/\s+/g, "")
					.replace(/\+/g, "-")
					.replace(/\//g, "_")
					.replace(/=+$/, ""),
			);
		} catch {
			continue;
		}
		const type = (first(body, "mime") ?? "application/octet-stream").trim();
		const name =
			decode(first(body, "file-name") ?? "").trim() ||
			`attachment.${type.split("/")[1] ?? "bin"}`;
		out.push({ hash: hex(md5(bytes)), file: { name, type, bytes } });
	}
	return out;
}

/** ENML to plain HTML: media placeholders become images, to-dos become checkbox characters. */
export function enmlToHtml(
	enml: string,
	refFor: (hash: string) => string | null,
): string {
	return enml
		.replace(/<\?xml[^>]*\?>/g, "")
		.replace(/<!DOCTYPE[^>]*>/gi, "")
		.replace(
			/<en-media\b([^>]*?)\/?>(?:<\/en-media>)?/g,
			(_, attrs: string) => {
				const hash = attrs.match(/hash="([0-9a-f]+)"/i)?.[1] ?? "";
				const type = attrs.match(/type="([^"]+)"/i)?.[1] ?? "";
				const ref = refFor(hash);
				return ref && type.startsWith("image/") ? `<img src="${ref}">` : "";
			},
		)
		.replace(/<en-todo\b([^>]*?)\/?>(?:<\/en-todo>)?/g, (_, attrs: string) =>
			/checked="true"/i.test(attrs) ? "☑ " : "☐ ",
		)
		.replace(/<\/?en-note[^>]*>/g, "");
}

export function parseEvernote(entries: Entries): Parsed {
	const notes: ImportedNote[] = [];
	const skipped: Parsed["skipped"] = [];

	for (const [path, bytes] of entries) {
		if (extname(path) !== "enex") continue;
		const xml = text(bytes);
		const book = stem(path);
		let count = 0;
		for (const m of xml.matchAll(/<note>([\s\S]*?)<\/note>/g)) {
			count++;
			const src = m[1] as string;
			const title = decode(first(src, "title") ?? "").trim() || "Untitled";
			const enml = (first(src, "content") ?? "")
				.replace(/^\s*<!\[CDATA\[/, "")
				.replace(/\]\]>\s*$/, "");
			const note = newNote(`${path}: ${title}`, title, {
				kind: "html",
				text: "",
			});
			note.parents = [book];
			note.createdAt = enexDate(first(src, "created"));
			note.updatedAt = enexDate(first(src, "updated"));
			// <tag> elements sit beside <content>, never inside it.
			const outside = src
				.replace(/<content>[\s\S]*?<\/content>/, "")
				.replace(/<resource>[\s\S]*?<\/resource>/g, "");
			note.tags = [...outside.matchAll(/<tag>([\s\S]*?)<\/tag>/g)]
				.map((t) => decode(t[1] as string).trim())
				.filter(Boolean);

			const resources = resourcesOf(src);
			const used = new Set<string>();
			const html = enmlToHtml(enml, (hash) => {
				const r = resources.find((x) => x.hash === hash);
				if (!r) return null;
				const ref = `seijaku-file:${hash}`;
				note.files[ref] = r.file;
				used.add(hash);
				return ref;
			});
			// Attachments that are not pictures in the text (PDFs, audio, ...) go at the end.
			for (const r of resources)
				if (!used.has(r.hash)) note.extras.push(r.file);
			note.body.text = html;
			notes.push(note);
		}
		if (count === 0)
			skipped.push({ source: path, reason: "No notes found in this file" });
	}
	return { notes, skipped };
}
