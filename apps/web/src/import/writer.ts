import { BlockNoteEditor } from "@blocknote/core";
import { blocksToYXmlFragment } from "@blocknote/core/yjs";
import { createNote, normalizeTag, updateNote } from "@seijaku/sync";
import type * as Y from "yjs";
import { schema } from "../editor/schema";
import { i18n } from "../i18n";
import { uploadFile } from "../workspace/files";
import { workspace } from "../workspace/store";
import {
	type ImportedFile,
	type ImportedNote,
	isImage,
	type Parsed,
} from "./model";

/**
 * The one writer every importer shares: makes the pages (and the folders they sit in),
 * turns each body into blocks, uploads the files, and keeps a tally for the progress screen.
 * It runs on this device, so an import works offline; files need an account, because they
 * are sealed with the workspace key.
 */

export interface NoteResult {
	note: ImportedNote;
	state: "done" | "warn";
	/** "2 images · #math #signals", or what went wrong. */
	detail: string;
	/** Files that were saved with this note. */
	files: number;
	/** Of those, the pictures. */
	images: number;
}

export interface WriteOptions {
	signal?: AbortSignal;
	/** A note is about to be written. */
	onStart?: (note: ImportedNote) => void;
	/** A note is finished (or could not be written). */
	onResult?: (result: NoteResult, done: number, total: number) => void;
}

export interface WriteSummary {
	/** Ids of the pages made from notes, in order. */
	ids: string[];
	images: number;
	tags: number;
	skipped: number;
	/** The "Import report" page, when anything was skipped. */
	reportId: string | null;
}

type Block = {
	type: string;
	props?: Record<string, unknown>;
	children?: Block[];
};

const MEDIA = new Set(["image", "video", "audio", "file"]);

function blockFor(url: string, file: ImportedFile): Block {
	const type = isImage(file.type)
		? "image"
		: file.type.startsWith("video/")
			? "video"
			: file.type.startsWith("audio/")
				? "audio"
				: "file";
	return { type, props: { url, name: file.name } };
}

const pathKey = (parents: string[], title: string) =>
	[...parents, title].join("\u0000");

export async function writeNotes(
	parsed: Parsed,
	opts: WriteOptions = {},
): Promise<WriteSummary> {
	const parser = BlockNoteEditor.create({ schema });
	const ids: string[] = [];
	const tags = new Set<string>();
	const skipped = [...parsed.skipped];
	const pageIds = new Map<string, string>();
	const uploads = new Map<ImportedFile, string | null>();
	let images = 0;
	let canUpload = true;
	let uploadProblem: string | null = null;

	/** Pages for the folders a note sits in, made once and reused. */
	const ensureParents = (parents: string[]): string | null => {
		let parentId: string | null = null;
		for (let i = 1; i <= parents.length; i++) {
			const key = pathKey(parents.slice(0, i - 1), parents[i - 1] as string);
			let id = pageIds.get(key);
			if (!id) {
				id = createNote(workspace.index, {
					title: parents[i - 1] as string,
					parentId,
				});
				pageIds.set(key, id);
			}
			parentId = id;
		}
		return parentId;
	};

	const upload = async (file: ImportedFile): Promise<string | null> => {
		if (uploads.has(file)) return uploads.get(file) ?? null;
		let url: string | null = null;
		if (canUpload) {
			try {
				url = await uploadFile(
					new File([file.bytes as BlobPart], file.name, { type: file.type }),
				);
				images++;
			} catch (err) {
				const message = err instanceof Error ? err.message : "Upload failed";
				// Signed out or locked: no later file will work either, so stop trying.
				if (/sign in|unlock/i.test(message)) {
					canUpload = false;
					uploadProblem = message;
				} else uploadProblem = message;
			}
		}
		uploads.set(file, url);
		return url;
	};

	/** Swaps the importer's file references for uploaded addresses. Returns how many files were lost. */
	const attach = async (
		blocks: Block[],
		note: ImportedNote,
	): Promise<number> => {
		let lost = 0;
		for (const b of blocks) {
			const url = String(b.props?.url ?? "");
			const file = MEDIA.has(b.type) ? note.files[url] : undefined;
			if (file && b.props) {
				const made = await upload(file);
				if (made) b.props.url = made;
				else {
					b.props.url = "";
					lost++;
				}
			}
			if (b.children) lost += await attach(b.children, note);
		}
		return lost;
	};

	const ordered = [...parsed.notes].sort(
		(a, b) => a.parents.length - b.parents.length,
	);
	const total = ordered.length;
	let done = 0;

	for (const note of ordered) {
		if (opts.signal?.aborted) break;
		opts.onStart?.(note);
		try {
			const blocks = (note.body.kind === "markdown"
				? await parser.tryParseMarkdownToBlocks(note.body.text)
				: note.body.kind === "html"
					? await parser.tryParseHTMLToBlocks(note.body.text)
					: note.body.text.split(/\r?\n/).map((line) => ({
							type: "paragraph",
							content: line,
						}))) as unknown as Block[];

			let lost = await attach(blocks, note);
			for (const extra of note.extras) {
				const url = await upload(extra);
				if (url) blocks.push(blockFor(url, extra));
				else lost++;
			}

			const parentId = ensureParents(note.parents);
			const key = pathKey(note.parents, note.title);
			const known = pageIds.get(key);
			// A page that was already made as a folder for its children becomes this note.
			const id =
				known ??
				createNote(workspace.index, {
					title: note.title,
					parentId,
					tags: note.tags.map(normalizeTag).filter(Boolean),
					now: note.updatedAt ?? note.createdAt ?? Date.now(),
				});
			pageIds.set(key, id);
			if (known) {
				updateNote(workspace.index, id, {
					tags: note.tags.map(normalizeTag).filter(Boolean),
				});
			}
			for (const t of note.tags) tags.add(normalizeTag(t));

			await workspace.withFragment(id, (fragment) => {
				(fragment.doc as Y.Doc).transact(() => {
					blocksToYXmlFragment(parser, blocks as never, fragment);
				});
			});
			ids.push(id);

			if (lost > 0)
				note.warnings.push(
					`${lost} ${lost === 1 ? "file" : "files"} left out${uploadProblem ? `: ${uploadProblem}` : ""}`,
				);
			const placed = Object.keys(note.files).length + note.extras.length - lost;
			const bits = [
				...(placed > 0 ? [`${placed} ${placed === 1 ? "file" : "files"}`] : []),
				...(note.tags.length ? [note.tags.map((t) => `#${t}`).join(" ")] : []),
			];
			done++;
			const warn = note.warnings.length > 0;
			opts.onResult?.(
				{
					note,
					state: warn ? "warn" : "done",
					detail: warn ? note.warnings.join("; ") : bits.join(" · "),
					files: placed,
					images: Object.values(note.files).filter(
						(f) => isImage(f.type) && uploads.get(f),
					).length,
				},
				done,
				total,
			);
			if (warn)
				skipped.push({ source: note.source, reason: note.warnings.join("; ") });
		} catch (err) {
			done++;
			const reason =
				err instanceof Error ? err.message : "Could not be imported";
			skipped.push({ source: note.source, reason });
			opts.onResult?.(
				{ note, state: "warn", detail: reason, files: 0, images: 0 },
				done,
				total,
			);
		}
	}

	let reportId: string | null = null;
	if (skipped.length > 0) {
		reportId = createNote(workspace.index, {
			title: i18n.t("import.reportTitle"),
		});
		const lines = [
			i18n.t("import.reportHead", { count: skipped.length }),
			"",
			...skipped.map((s) => `${s.source}: ${s.reason}`),
		];
		await workspace.withFragment(reportId, (fragment) => {
			(fragment.doc as Y.Doc).transact(() => {
				blocksToYXmlFragment(
					parser,
					lines.map((content) => ({ type: "paragraph", content })) as never,
					fragment,
				);
			});
		});
	}

	return {
		ids,
		images,
		tags: tags.size,
		skipped: skipped.length,
		reportId,
	};
}
