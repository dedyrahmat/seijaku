import { text } from "./markdown";
import { type Entries, extname } from "./model";

/**
 * Works out where an export came from, so nobody has to say. Anything that cannot be told
 * apart (a folder of Markdown, HTML or text, which is also what Apple Notes and Apple Journal
 * exports look like) is read as plain files and folders.
 */

const NOTION_NAME = / [0-9a-f]{32}(?=\.|\/|$)/;
const WIKILINK = /\[\[[^\]\n]+\]\]/;

function looksLikeKeep(bytes: Uint8Array): boolean {
	try {
		const data = JSON.parse(text(bytes)) as Record<string, unknown>;
		return (
			typeof data === "object" &&
			data !== null &&
			("textContent" in data ||
				"listContent" in data ||
				"userEditedTimestampUsec" in data)
		);
	} catch {
		return false;
	}
}

/** The id of one of the sources in sources.ts. */
export function detectSource(entries: Entries): string {
	let notionNames = 0;
	let wikilinks = 0;
	let keepNotes = 0;
	let markdown = 0;
	for (const [path, bytes] of entries) {
		const ext = extname(path);
		if (ext === "enex") return "evernote";
		if (/(^|\/)\.obsidian\//.test(path)) return "obsidian";
		if (NOTION_NAME.test(path) && (ext === "md" || ext === "csv"))
			notionNames++;
		if (ext === "json" && keepNotes < 3 && looksLikeKeep(bytes)) keepNotes++;
		if (ext === "md") {
			markdown++;
			// Only a sample: wikilinks show up in the first few notes of any real vault.
			if (markdown <= 50 && WIKILINK.test(text(bytes))) wikilinks++;
		}
	}
	if (keepNotes > 0) return "keep";
	if (notionNames > 0) return "notion";
	if (wikilinks > 0) return "obsidian";
	// A single kind of file keeps its own, narrower reading; a mix is read as files and folders.
	return "files";
}
