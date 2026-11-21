import { BlockNoteEditor } from "@blocknote/core";
import {
	blocksToYXmlFragment,
	yXmlFragmentToBlocks,
} from "@blocknote/core/yjs";
import { createNote, ensureDailyNote, getNote, touchNote } from "@seijaku/sync";
import { schema } from "../editor/schema";
import { workspace } from "./store";

/**
 * Quick capture: adds the text to the end of the chosen note, one paragraph per line. `target` is
 * the "Add captures to" setting: "today", "new" (a fresh quick note) or "page:<id>". A page that
 * is gone or in the trash falls back to Today.
 */
export async function captureTo(target: string, text: string): Promise<string> {
	const page = target.startsWith("page:") ? target.slice(5) : "";
	const chosen = page ? getNote(workspace.index, page) : undefined;
	const id =
		target === "new"
			? createNote(workspace.index, { kind: "quick" })
			: chosen && !chosen.trashed
				? page
				: ensureDailyNote(workspace.index, new Date());
	const session = workspace.openNote(id);
	await session.ready;
	const editor = BlockNoteEditor.create({ schema });
	const existing = yXmlFragmentToBlocks(editor, session.fragment);
	const added = text
		.trim()
		.split(/\r?\n/)
		.map((line) => ({ type: "paragraph" as const, content: line }));
	session.doc.transact(() => {
		blocksToYXmlFragment(
			editor,
			[...existing, ...added] as never,
			session.fragment,
		);
	});
	touchNote(workspace.index, id);
	return id;
}
