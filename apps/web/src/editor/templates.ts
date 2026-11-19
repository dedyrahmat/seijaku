import { blocksToYXmlFragment } from "@blocknote/core/yjs";
import type { NoteKind } from "@seijaku/sync";
import type * as Y from "yjs";
import { workspace } from "../workspace/store";
import { headless } from "./headless";

type Draft = {
	type: string;
	props?: Record<string, unknown>;
	content?: unknown;
};

const heading = (content: string): Draft => ({
	type: "heading",
	props: { level: 2 },
	content,
});
const para = (): Draft => ({ type: "paragraph", content: "" });
const todo = (): Draft => ({ type: "checkListItem", content: "" });

/** What each shape of note starts with. Pages, quick notes and journal entries start empty. */
const TEMPLATES: Partial<Record<NoteKind, Draft[]>> = {
	checklist: [todo(), todo(), todo()],
	meeting: [
		heading("Who was there"),
		para(),
		heading("What was said"),
		para(),
		heading("What happens next"),
		todo(),
	],
	study: [
		{
			type: "callout",
			props: { tone: "tip" },
			content: [{ type: "text", text: "Key idea. ", styles: { bold: true } }],
		},
		heading("Maths"),
		{ type: "math", content: "" },
		heading("Code"),
		{ type: "codeBlock", content: "" },
		heading("Questions to revisit"),
		{ type: "toggleListItem", content: "" },
	],
};

/** Writes the starting blocks for `kind` into a note that has just been made. */
export async function applyTemplate(id: string, kind: NoteKind) {
	const blocks = TEMPLATES[kind];
	if (!blocks) return;
	await workspace.withFragment(id, (fragment) => {
		(fragment.doc as Y.Doc).transact(() => {
			blocksToYXmlFragment(headless(), blocks as never, fragment);
		});
	});
}
