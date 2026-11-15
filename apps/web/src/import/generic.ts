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
): Promise<string[]> {
	const parser = BlockNoteEditor.create({ schema });
	const ids: string[] = [];
	for (const [i, file] of files.entries()) {
		const text = await file.text();
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
