import { BlockNoteEditor } from "@blocknote/core";
import { yXmlFragmentToBlocks } from "@blocknote/core/yjs";
import type * as Y from "yjs";
import { schema } from "./schema";

/** A block as plain data: what history, export and sharing read out of a note. */
export interface Block {
	type: string;
	props: Record<string, unknown>;
	content?: unknown;
	children: Block[];
}

let editor: BlockNoteEditor<never, never, never> | null = null;

/** An editor that is never shown: it only converts between a note's Yjs content and blocks. */
export function headless(): BlockNoteEditor<never, never, never> {
	editor ??= BlockNoteEditor.create({
		schema,
	}) as unknown as BlockNoteEditor<never, never, never>;
	return editor;
}

export function fragmentBlocks(fragment: Y.XmlFragment): Block[] {
	return yXmlFragmentToBlocks(headless(), fragment) as unknown as Block[];
}
