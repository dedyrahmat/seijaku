import { BlockNoteEditor } from "@blocknote/core";
import {
	blocksToYXmlFragment,
	yXmlFragmentToBlocks,
} from "@blocknote/core/yjs";
import { ensureDailyNote, touchNote } from "@seijaku/sync";
import { schema } from "../editor/schema";
import { workspace } from "./store";

/** Quick capture: adds the text to the end of today's daily note, one paragraph per line. */
export async function captureToToday(text: string): Promise<string> {
	const id = ensureDailyNote(workspace.index, new Date());
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
