import { lookupFile, nameIndex, rewriteImages, text } from "./markdown";
import {
	basename,
	dirname,
	type Entries,
	extname,
	FileRefs,
	frontmatter,
	type ImportedNote,
	newNote,
	type Parsed,
	parseDate,
	stem,
	tagList,
} from "./model";

/**
 * Plain files and folders: Markdown, HTML or text, one page per file, folders as parent
 * pages. This is also how Apple Notes and Apple Journal exports are read (Apple has no
 * official bulk export, so those arrive as HTML or Markdown files from whichever tool made
 * them); images beside the files are found by their relative paths.
 */

export type FolderKind = "markdown" | "html" | "text";

const EXTS: Record<FolderKind, string[]> = {
	markdown: ["md", "markdown"],
	html: ["html", "htm"],
	text: ["txt"],
};

const ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
};
const plain = (s: string) =>
	s
		.replace(/<[^>]*>/g, "")
		.replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m)
		.replace(/\s+/g, " ")
		.trim();

export function parseFolder(entries: Entries, kinds: FolderKind[]): Parsed {
	const notes: ImportedNote[] = [];
	const skipped: Parsed["skipped"] = [];
	const byName = nameIndex(
		entries,
		(p) => !Object.values(EXTS).flat().includes(extname(p)),
	);

	for (const [path, bytes] of entries) {
		const ext = extname(path);
		const kind = kinds.find((k) => EXTS[k].includes(ext));
		if (!kind) continue;
		const raw = text(bytes);
		const note = newNote(path, stem(path), { kind, text: "" });
		note.parents = dirname(path).split("/").filter(Boolean);
		const refs = new FileRefs(entries, note.files);

		if (kind === "markdown") {
			const { data, body } = frontmatter(raw);
			note.tags = tagList(data.tags ?? data.tag);
			note.createdAt = parseDate(data.created ?? data.date);
			note.updatedAt = parseDate(data.modified ?? data.updated);
			const heading = body.match(/^\s*#\s+(.+?)\s*(?:\r?\n|$)/);
			let md = body;
			if (heading && stem(path) === note.title) {
				// A leading heading that names the page would repeat as the title.
				note.title = (heading[1] as string).trim();
				md = body.slice((heading.index ?? 0) + heading[0].length);
			}
			note.body.text = rewriteImages(
				md,
				entries,
				byName,
				path,
				refs,
				note.warnings,
			).trim();
		} else if (kind === "html") {
			const title = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
			if (title && plain(title)) note.title = plain(title);
			const inner = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? raw;
			note.body.text = inner
				.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
				.replace(
					/(<(?:img|source|video|audio)\b[^>]*?\bsrc=)(["'])(.*?)\2/gi,
					(whole, head: string, q: string, src: string) => {
						if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) return whole;
						const found = lookupFile(entries, byName, dirname(path), src);
						const ref = found ? refs.ref(found) : null;
						if (!ref) {
							note.warnings.push(`Image not found: ${basename(src)}`);
							return `${head}${q}${q}`;
						}
						return `${head}${q}${ref}${q}`;
					},
				);
		} else {
			note.body.text = raw;
		}
		notes.push(note);
	}
	return { notes, skipped };
}
