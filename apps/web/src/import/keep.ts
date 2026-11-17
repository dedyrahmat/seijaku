import { text } from "./markdown";
import {
	basename,
	dirname,
	type Entries,
	extname,
	FileRefs,
	type ImportedNote,
	mimeFor,
	newNote,
	type Parsed,
} from "./model";

/**
 * Google Keep through Google Takeout: one .json per note, with its attachments beside it.
 * Labels become tags, checklists become checkboxes, the Keep timestamps are kept, and trashed
 * notes are left behind.
 */

interface KeepNote {
	title?: string;
	textContent?: string;
	listContent?: { text?: string; isChecked?: boolean }[];
	labels?: { name?: string }[];
	attachments?: { filePath?: string; mimetype?: string }[];
	annotations?: { title?: string; url?: string }[];
	createdTimestampUsec?: number;
	userEditedTimestampUsec?: number;
	isTrashed?: boolean;
}

const looksLikeKeep = (n: unknown): n is KeepNote =>
	typeof n === "object" &&
	n !== null &&
	("textContent" in n || "listContent" in n || "userEditedTimestampUsec" in n);

export function parseKeep(entries: Entries): Parsed {
	const notes: ImportedNote[] = [];
	const skipped: Parsed["skipped"] = [];

	for (const [path, bytes] of entries) {
		if (extname(path) !== "json") continue;
		let data: unknown;
		try {
			data = JSON.parse(text(bytes));
		} catch {
			skipped.push({ source: path, reason: "Not a readable Keep note" });
			continue;
		}
		if (!looksLikeKeep(data)) continue;
		if (data.isTrashed) {
			skipped.push({ source: path, reason: "Was in the Keep trash" });
			continue;
		}

		const lines: string[] = [];
		if (data.textContent?.trim()) lines.push(data.textContent.trim());
		if (data.listContent?.length)
			lines.push(
				data.listContent
					.filter((i) => (i.text ?? "").trim() !== "")
					.map((i) => `- [${i.isChecked ? "x" : " "}] ${i.text}`)
					.join("\n"),
			);
		if (data.annotations?.length)
			lines.push(
				data.annotations
					.filter((a) => a.url)
					.map((a) => `- [${a.title || a.url}](${a.url})`)
					.join("\n"),
			);

		const firstLine = (data.textContent ?? "").trim().split(/\r?\n/)[0] ?? "";
		const title =
			data.title?.trim() ||
			firstLine.slice(0, 60) ||
			basename(path).replace(/\.json$/i, "");
		const note = newNote(path, title, {
			kind: "markdown",
			text: lines.join("\n\n"),
		});
		note.tags = (data.labels ?? []).map((l) => l.name ?? "").filter(Boolean);
		if (data.createdTimestampUsec)
			note.createdAt = Math.round(data.createdTimestampUsec / 1000);
		if (data.userEditedTimestampUsec)
			note.updatedAt = Math.round(data.userEditedTimestampUsec / 1000);

		const refs = new FileRefs(entries, note.files);
		const dir = dirname(path);
		for (const att of data.attachments ?? []) {
			const file = att.filePath
				? `${dir}/${att.filePath}`.replace(/^\//, "")
				: "";
			const ref = file ? refs.ref(file) : null;
			if (!ref) {
				note.warnings.push(
					`Attachment not in the export: ${att.filePath ?? "unnamed"}`,
				);
				continue;
			}
			const imported = note.files[ref];
			if (!imported) continue;
			if (att.mimetype) imported.type = att.mimetype;
			else imported.type = mimeFor(file);
			// Placed at the end as its own block: Keep attaches files to the note, not to a line.
			delete note.files[ref];
			note.extras.push(imported);
		}
		notes.push(note);
	}
	return { notes, skipped };
}
