import {
	lookupFile,
	nameIndex,
	outsideCode,
	pageLinkMarkdown,
	rewriteImages,
	text,
} from "./markdown";
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
import { canvasToMarkdown } from "./tables";

/**
 * An Obsidian vault: Markdown files in folders. Folders become parent pages; frontmatter
 * and #inline tags become tags; ![[image]] embeds become images; [[links]] become page links
 * (the writer matches them to imported pages by title); %%comments%% are dropped.
 */

const SKIP_DIR = /(^|\/)(\.obsidian|\.trash)(\/|$)/;
const INLINE_TAG = /(^|[\s(])#([\p{L}_][\p{L}\p{N}_/-]*)/gu;

export function parseObsidian(entries: Entries): Parsed {
	const notes: ImportedNote[] = [];
	const skipped: Parsed["skipped"] = [];
	const byName = nameIndex(
		entries,
		(p) => !SKIP_DIR.test(p) && extname(p) !== "md" && extname(p) !== "json",
	);

	for (const [path, bytes] of entries) {
		if (SKIP_DIR.test(path)) continue;
		const ext = extname(path);
		if (ext === "canvas") {
			const md = canvasToMarkdown(text(bytes));
			if (!md) {
				skipped.push({ source: path, reason: "Canvas board has no cards" });
				continue;
			}
			const note = newNote(path, stem(path), { kind: "markdown", text: md });
			note.parents = dirname(path).split("/").filter(Boolean);
			note.warnings.push(
				"Layout and arrows are not kept; cards are listed in reading order",
			);
			notes.push(note);
			continue;
		}
		if (ext !== "md") continue;

		const { data, body: raw } = frontmatter(text(bytes));
		const note = newNote(path, stem(path), { kind: "markdown", text: "" });
		note.parents = dirname(path).split("/").filter(Boolean);
		note.createdAt = parseDate(data.created ?? data.date ?? data.created_at);
		note.updatedAt = parseDate(data.modified ?? data.updated ?? data.mtime);
		const tags = new Set(tagList(data.tags ?? data.tag));
		const refs = new FileRefs(entries, note.files);
		const dir = dirname(path);

		let body = raw.replace(/%%[\s\S]*?%%/g, "");
		body = outsideCode(body, (prose) =>
			prose
				// ![[image.png|300]] and ![[Another note]]
				.replace(
					/!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g,
					(_, target: string) => {
						const name = target.trim();
						if (extname(name) && extname(name) !== "md") {
							const found = lookupFile(entries, byName, dir, name);
							const ref = found ? refs.ref(found) : null;
							if (ref) return `![${basename(name)}](${ref})`;
							note.warnings.push(`File not found: ${name}`);
							return `*(missing file: ${name})*`;
						}
						return `*Embedded note: ${name.replace(/\.md$/, "")}*`;
					},
				)
				// [[Note]], [[Note#Heading]], [[Note|shown text]]
				.replace(
					/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g,
					(_, target: string, alias?: string) =>
						pageLinkMarkdown((alias ?? target).trim(), target.trim()),
				),
		);
		body = rewriteImages(body, entries, byName, path, refs, note.warnings);

		outsideCode(body, (prose) => {
			for (const m of prose.matchAll(INLINE_TAG)) {
				const tag = (m[2] as string).toLowerCase();
				if (!/^\d+$/.test(tag)) tags.add(tag);
			}
			return prose;
		});

		note.tags = [...tags];
		note.body.text = body.trim();
		notes.push(note);
	}
	return { notes, skipped };
}
