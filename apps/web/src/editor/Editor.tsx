import { syntaxHighlighter } from "@blocknote/code-block";
import {
	type BlockNoteEditor,
	filterSuggestionItems,
	insertOrUpdateBlockForSlashMenu,
} from "@blocknote/core";
import "@blocknote/core/fonts/inter.css";
import { withCollaboration } from "@blocknote/core/yjs";
import { BlockNoteView } from "@blocknote/mantine";
import {
	getDefaultReactSlashMenuItems,
	SuggestionMenuController,
	useCreateBlockNote,
} from "@blocknote/react";
import "@blocknote/mantine/style.css";
import { touchNote } from "@seijaku/sync";
import "katex/dist/katex.min.css";
import { type MutableRefObject, useEffect, useRef } from "react";
import { useColorScheme } from "../theme";
import { resolveFileUrl, uploadFile } from "../workspace/files";
import { flushSnapshot, noteEdited } from "../workspace/history";
import { sharedNoteEdited } from "../workspace/shares";
import type { NoteSession } from "../workspace/store";
import { workspace } from "../workspace/store";
import { MobileToolbar } from "./MobileToolbar";
import { schema } from "./schema";
import { setOwnerNames } from "./todoProps";

/** BlockNote keys group headers by name, so items of one group must sit together. */
function keepGroupsTogether<T extends { group?: string }>(items: T[]): T[] {
	const order: (string | undefined)[] = [];
	for (const item of items) {
		if (!order.includes(item.group)) order.push(item.group);
	}
	return order.flatMap((g) => items.filter((item) => item.group === g));
}

// biome-ignore lint/suspicious/noExplicitAny: blocks are read through BlockNote's untyped runtime API here
type AnyBlock = any;

/** Moves ticked to-dos below the last unticked one among their siblings, in one transaction. */
// biome-ignore lint/suspicious/noExplicitAny: see AnyBlock
function settleDone(editor: any, siblings: AnyBlock[]) {
	const todo = (b: AnyBlock) => b.type === "checkListItem";
	let lastOpen = -1;
	// Blank to-dos waiting to be typed into do not count: a done item sinks below the real ones.
	const blank = (b: AnyBlock) =>
		!(Array.isArray(b.content) ? b.content : []).some(
			(c: { type?: string; text?: string }) =>
				c.type !== "text" || (c.text ?? "").trim() !== "",
		);
	siblings.forEach((b, i) => {
		if (todo(b) && !b.props.checked && !blank(b)) lastOpen = i;
	});
	const moved = siblings.filter(
		(b, i) => i < lastOpen && todo(b) && b.props.checked,
	);
	if (moved.length === 0) return;
	editor.transact(() => {
		let anchor = siblings[lastOpen].id;
		for (const b of moved) {
			editor.removeBlocks([b.id]);
			anchor = editor.insertBlocks([b], anchor, "after")[0].id;
		}
	});
}

/** The slash menu's "Blocks" group: BlockNote's title, the board's name, and a Markdown hint where one really works. */
const BLOCKS: [string, string, string][] = [
	["Paragraph", "Text", "Plain writing"],
	["Heading 1", "Heading", "Type # and a space"],
	["Check List", "To-do list", "Type [] and a space"],
	["Bullet List", "Bulleted list", "Type - and a space"],
	["Toggle List", "Toggle", "Hide detail inside"],
	["Quote", "Quote", "Set a line apart"],
	["Code Block", "Code", "Type ``` and a space"],
	["Math", "Math", "An equation in LaTeX"],
	["Table", "Table", "Rows and columns"],
	["Callout", "Callout", "Set a thought apart from the page"],
];

interface Props {
	session: NoteSession;
	/** Lets the title field hand focus to the editor on Enter. */
	focusRef?: MutableRefObject<(() => void) | null>;
	/** Start with the cursor in the body (a new quick note). */
	autoFocus?: boolean;
	/** Ticked to-dos sink to the bottom of their list (a checklist note). */
	sortDone?: boolean;
	/** Names the to-do owner box suggests first (a meeting's attendees). */
	owners?: string[];
	/** Gives the parent the editor, for things like "Show tick boxes". */
	editorRef?: MutableRefObject<BlockNoteEditor<
		AnyBlock,
		AnyBlock,
		AnyBlock
	> | null>;
}

export function Editor({
	session,
	focusRef,
	autoFocus,
	sortDone,
	owners,
	editorRef,
}: Props) {
	const scheme = useColorScheme();
	const touchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);

	const editor = useCreateBlockNote(
		withCollaboration({
			schema,
			uploadFile,
			resolveFileUrl,
			extensions: [syntaxHighlighter],
			collaboration: {
				fragment: session.fragment,
				user: { name: "You", color: "#AE3B28" },
			},
		}),
		[session.id],
	);

	useEffect(() => {
		if (autoFocus) editor.focus();
	}, [editor, autoFocus]);

	useEffect(() => {
		setOwnerNames(owners ?? []);
	}, [owners]);

	useEffect(() => {
		if (!editorRef) return;
		editorRef.current = editor;
		return () => {
			editorRef.current = null;
		};
	}, [editor, editorRef]);

	// Ticks made elsewhere (the Today list) are sorted the next time the list opens.
	useEffect(() => {
		if (sortDone) settleDone(editor, editor.document);
	}, [editor, sortDone]);

	useEffect(() => {
		if (!focusRef) return;
		focusRef.current = () => editor.focus();
		return () => {
			focusRef.current = null;
		};
	}, [editor, focusRef]);

	useEffect(() => {
		const id = session.id;
		return () => {
			clearTimeout(touchTimer.current);
			flushSnapshot(id); // leaving the page: keep what was written as a version
		};
	}, [session.id]);

	return (
		<BlockNoteView
			editor={editor}
			theme={scheme}
			slashMenu={false}
			onChange={(_, { getChanges }) => {
				if (sortDone) {
					for (const c of getChanges()) {
						if (
							c.type === "update" &&
							c.source.type === "local" &&
							c.block.type === "checkListItem" &&
							(c.block.props as { checked?: boolean }).checked &&
							!(c.prevBlock.props as { checked?: boolean }).checked
						)
							settleDone(
								editor,
								editor.getParentBlock(c.block.id)?.children ?? editor.document,
							);
					}
				}
				noteEdited(session.id);
				sharedNoteEdited(session.id);
				clearTimeout(touchTimer.current);
				touchTimer.current = setTimeout(
					() => touchNote(workspace.index, session.id),
					1500,
				);
			}}
		>
			<SuggestionMenuController
				triggerCharacter="/"
				getItems={async (query) => {
					const defaults = getDefaultReactSlashMenuItems(editor);
					const extra = [
						{
							title: "Callout",
							subtext: "Set a thought apart from the page",
							aliases: ["note", "aside", "tip", "warning"],
							group: "Basic blocks",
							icon: <span aria-hidden>ℹ</span>,
							onItemClick: () =>
								insertOrUpdateBlockForSlashMenu(editor, { type: "callout" }),
						},
						{
							title: "Link preview",
							subtext: "Show a web page as a card",
							aliases: ["bookmark", "embed", "url", "card"],
							group: "Media",
							icon: <span aria-hidden>↗</span>,
							onItemClick: () =>
								insertOrUpdateBlockForSlashMenu(editor, {
									type: "linkPreview",
								}),
						},
						{
							title: "Math",
							subtext: "Write an equation in LaTeX",
							aliases: ["latex", "equation", "formula", "katex"],
							group: "Advanced",
							icon: <span aria-hidden>∑</span>,
							onItemClick: () =>
								insertOrUpdateBlockForSlashMenu(editor, { type: "math" }),
						},
					];
					const all = [...defaults, ...extra];
					// Typing finds every block; the open menu is the board's one "Blocks" group, in its order.
					if (query)
						return filterSuggestionItems(keepGroupsTogether(all), query);
					return BLOCKS.flatMap(([title, as, hint]) => {
						const item = all.find((i) => i.title === title);
						return item
							? [{ ...item, title: as, group: "Blocks", subtext: hint }]
							: [];
					});
				}}
			/>
			<MobileToolbar editor={editor} />
		</BlockNoteView>
	);
}
