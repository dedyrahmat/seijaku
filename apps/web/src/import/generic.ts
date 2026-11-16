import { BlockNoteEditor } from "@blocknote/core";
import { blocksToYXmlFragment } from "@blocknote/core/yjs";
import { createNote } from "@seijaku/sync";
import { schema } from "../editor/schema";
import { workspace } from "../workspace/store";

export type SourceKind = "markdown" | "html" | "text";

export const ACCEPT: Record<SourceKind, string> = {
	markdown: ".md,.markdown",
	html: ".html,.htm",
	text: ".txt",
};

function titleOf(name: string): string {
	return name.replace(/\.[^.]+$/, "");
}

/**
 * Turns each file into a top-level page. Runs entirely on this device, so it works offline
 * and the pages sync like any others. Returns the ids of the pages made, in file order.
 */
export async function importFiles(
	files: File[],
	kind: SourceKind,
	onProgress?: (done: number, total: number) => void,
	opts: {
		signal?: AbortSignal;
		/** A file that could not be read; the import carries on with the next one. */
		onSkip?: (file: File, reason: string) => void;
	} = {},
): Promise<string[]> {
	const parser = BlockNoteEditor.create({ schema });
	const ids: string[] = [];
	for (const [i, file] of files.entries()) {
		if (opts.signal?.aborted) break;
		let text: string;
		try {
			text = await file.text();
		} catch (err) {
			opts.onSkip?.(
				file,
				err instanceof Error ? err.message : "Could not read",
			);
			onProgress?.(i + 1, files.length);
			continue;
		}
		const blocks =
			kind === "markdown"
				? await parser.tryParseMarkdownToBlocks(text)
				: kind === "html"
					? await parser.tryParseHTMLToBlocks(text)
					: text
							.split(/\r?\n/)
							.map((line) => ({ type: "paragraph" as const, content: line }));
		const id = createNote(workspace.index, { title: titleOf(file.name) });
		const session = workspace.openNote(id);
		await session.ready;
		session.doc.transact(() => {
			blocksToYXmlFragment(parser, blocks as never, session.fragment);
		});
		ids.push(id);
		onProgress?.(i + 1, files.length);
	}
	return ids;
}
