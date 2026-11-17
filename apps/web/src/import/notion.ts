import { nameIndex, outsideCode, rewriteImages, text } from "./markdown";
import {
	dirname,
	type Entries,
	extname,
	FileRefs,
	type ImportedNote,
	newNote,
	type Parsed,
	parseDate,
	stem,
	tagList,
} from "./model";

/**
 * A Notion export ("Markdown & CSV"): every page is "Title <32 hex>.md", and a page's
 * sub-pages sit in a folder of the same name. The ids are dropped from titles, folders
 * become the page tree, a leading "Tags:" property becomes tags, and links between pages
 * become plain text. Database tables (CSV) are not imported; their rows are pages already.
 */

const ID = / [0-9a-f]{32}(?=\.|$)/;
const strip = (name: string): string => name.replace(ID, "");

export function parseNotion(entries: Entries): Parsed {
	const notes: ImportedNote[] = [];
	const skipped: Parsed["skipped"] = [];
	const byName = nameIndex(
		entries,
		(p) => extname(p) !== "md" && extname(p) !== "csv",
	);

	for (const [path, bytes] of entries) {
		const ext = extname(path);
		if (ext === "csv") {
			skipped.push({
				source: strip(path),
				reason: "Database tables are not imported; each row is its own page",
			});
			continue;
		}
		if (ext === "html" || ext === "htm") {
			skipped.push({
				source: strip(path),
				reason: "Export as Markdown & CSV, not HTML",
			});
			continue;
		}
		if (ext !== "md") continue;

		let body = text(bytes);
		let title = strip(stem(path));
		const heading = body.match(/^\s*#\s+(.+?)\s*(?:\r?\n|$)/);
		if (heading) {
			title = (heading[1] as string).trim();
			body = body.slice((heading.index ?? 0) + heading[0].length);
		}

		const note = newNote(strip(path), title || "Untitled", {
			kind: "markdown",
			text: "",
		});
		note.parents = dirname(path).split("/").filter(Boolean).map(strip);

		// Database-style properties sit under the title as "Key: value" lines.
		const lines = body.split(/\r?\n/);
		let i = 0;
		while (i < lines.length && (lines[i] as string).trim() === "") i++;
		const kept: string[] = [];
		const tags: string[] = [];
		let props = true;
		for (; i < lines.length; i++) {
			const line = lines[i] as string;
			const prop = props ? line.match(/^([A-Za-z][\w ]{0,30}):\s*(.*)$/) : null;
			if (!prop) {
				if (props && line.trim() === "") {
					props = false;
					continue;
				}
				props = false;
				kept.push(line);
				continue;
			}
			const key = (prop[1] as string).toLowerCase();
			if (key === "tags")
				tags.push(...tagList((prop[2] as string).split(/,\s*/)));
			else if (key === "created" || key === "created time")
				note.createdAt = parseDate(prop[2]);
			else if (key === "last edited" || key === "last edited time")
				note.updatedAt = parseDate(prop[2]);
			else kept.push(line);
		}
		note.tags = tags;

		const refs = new FileRefs(entries, note.files);
		let md = kept.join("\n");
		md = outsideCode(md, (prose) =>
			// Links to other pages: keep the words, drop the address.
			prose.replace(
				/(?<!!)\[([^\]]*)\]\((?!https?:|mailto:)([^)\n]+\.(?:md|csv)(?:#[^)]*)?)\)/gi,
				"$1",
			),
		);
		md = rewriteImages(md, entries, byName, path, refs, note.warnings);
		note.body.text = md.trim();
		notes.push(note);
	}
	return { notes, skipped };
}
