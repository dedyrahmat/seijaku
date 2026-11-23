import { syntaxHighlighter } from "@blocknote/code-block";
import {
	type BlockNoteEditor,
	filterSuggestionItems,
	insertOrUpdateBlockForSlashMenu,
} from "@blocknote/core";
import { useTranslation } from "react-i18next";
import "@blocknote/core/fonts/inter.css";
import { withCollaboration } from "@blocknote/core/yjs";
import { BlockNoteView } from "@blocknote/mantine";
import {
	getDefaultReactSlashMenuItems,
	SuggestionMenuController,
	useCreateBlockNote,
} from "@blocknote/react";
import "@blocknote/mantine/style.css";
import { createNote, touchNote } from "@seijaku/sync";
import "katex/dist/katex.min.css";
import { type MutableRefObject, useEffect, useRef } from "react";
import { getPrefs, usePrefs } from "../preferences";
import { useColorScheme } from "../theme";
import { resolveFileUrl, uploadFile } from "../workspace/files";
import { flushSnapshot, noteEdited } from "../workspace/history";
import { sharedNoteEdited } from "../workspace/shares";
import type { NoteSession } from "../workspace/store";
import { workspace } from "../workspace/store";
import { MobileToolbar } from "./MobileToolbar";
import { schema } from "./schema";
import { setOwnerNames } from "./todoProps";
import { typingExtension } from "./typingExtension";

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
const BLOCKS = [
	["Paragraph", "paragraph"],
	["Heading 1", "heading"],
	["Check List", "todo"],
	["Bullet List", "bullets"],
	["Toggle List", "toggle"],
	["Quote", "quote"],
	["Code Block", "code"],
	["Math", "math"],
	["Table", "table"],
	["Callout", "callout"],
] as const;

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
	/** A page this account may read but not change. */
	readOnly?: boolean;
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
	readOnly,
}: Props) {
	const { t } = useTranslation();
	const scheme = useColorScheme();
	const touchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);

	const editor = useCreateBlockNote(
		withCollaboration({
			schema,
			uploadFile,
			resolveFileUrl,
			extensions: [syntaxHighlighter, typingExtension],
			// "Paste behaviour": read when pasting, so changing it needs no reload.
			pasteHandler: ({ event, editor: ed, defaultPasteHandler }) => {
				if (getPrefs().pasteStyle !== "Plain text")
					return defaultPasteHandler();
				const text = event.clipboardData?.getData("text/plain");
				if (!text) return defaultPasteHandler();
				return ed.pasteText(text);
			},
			collaboration: {
				fragment: session.fragment,
				user: { name: "You", color: "#AE3B28" },
			},
		}),
		[session.id],
	);

	// "Spellcheck": the browser underlines on this device only.
	const spellcheck = usePrefs().spellcheck;
	useEffect(() => {
		editor.domElement?.setAttribute("spellcheck", String(spellcheck));
	}, [editor, spellcheck]);

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
			editable={!readOnly}
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
				triggerCharacter="[["
				getItems={async (query) => {
					const q = query.trim().toLowerCase();
					const link = (noteId: string) =>
						// biome-ignore lint/suspicious/noExplicitAny: the editor is typed by the schema, which this file reads loosely
						(editor as any).insertInlineContent([
							{ type: "pageLink", props: { noteId } },
							" ",
						]);
					const found = workspace
						.getNotes()
						.filter(
							(n) =>
								!n.trashed &&
								n.id !== session.id &&
								n.kind !== "quick" &&
								n.title.toLowerCase().includes(q),
						)
						.sort(
							(a, b) =>
								Number(b.title.toLowerCase().startsWith(q)) -
									Number(a.title.toLowerCase().startsWith(q)) ||
								b.updatedAt - a.updatedAt,
						)
						.slice(0, 8)
						.map((n) => ({
							title: n.title || t("common.untitled"),
							subtext:
								workspace.getNotes().find((p) => p.id === n.parentId)?.title ??
								"",
							onItemClick: () => link(n.id),
						}));
					if (!q) return found;
					const exact = found.some((i) => i.title.toLowerCase() === q);
					return exact
						? found
						: [
								...found,
								{
									title: t("wiki.create", { title: query.trim() }),
									subtext: t("wiki.createHint"),
									onItemClick: () =>
										link(createNote(workspace.index, { title: query.trim() })),
								},
							];
				}}
			/>
			<SuggestionMenuController
				triggerCharacter="/"
				getItems={async (query) => {
					const defaults = getDefaultReactSlashMenuItems(editor);
					const extra = [
						{
							title: t("editor.callout.title"),
							subtext: t("editor.callout.hint"),
							aliases: ["note", "aside", "tip", "warning"],
							group: t("editor.groups.basic"),
							icon: <span aria-hidden>ℹ</span>,
							onItemClick: () =>
								insertOrUpdateBlockForSlashMenu(editor, { type: "callout" }),
						},
						{
							title: t("editor.link.title"),
							subtext: t("editor.link.hint"),
							aliases: ["bookmark", "embed", "url", "card"],
							group: t("editor.groups.media"),
							icon: <span aria-hidden>↗</span>,
							onItemClick: () =>
								insertOrUpdateBlockForSlashMenu(editor, {
									type: "linkPreview",
								}),
						},
						{
							title: t("editor.math.title"),
							subtext: t("editor.math.hint"),
							aliases: ["latex", "equation", "formula", "katex"],
							group: t("editor.groups.advanced"),
							icon: <span aria-hidden>∑</span>,
							onItemClick: () =>
								insertOrUpdateBlockForSlashMenu(editor, { type: "math" }),
						},
					];
					const all = [...defaults, ...extra];
					// Typing finds every block; the open menu is the board's one "Blocks" group, in its order.
					if (query)
						return filterSuggestionItems(keepGroupsTogether(all), query);
					return BLOCKS.flatMap(([title, key]) => {
						// Callout and Math are ours, so their titles are translated; the rest are BlockNote's own English.
						const wanted =
							key === "callout"
								? t("editor.callout.title")
								: key === "math"
									? t("editor.math.title")
									: title;
						const item = all.find((i) => i.title === wanted);
						return item
							? [
									{
										...item,
										title: t(`editor.blocks.${key}.name`),
										group: t("editor.blocksGroup"),
										subtext: t(`editor.blocks.${key}.hint`),
									},
								]
							: [];
					});
				}}
			/>
			<MobileToolbar editor={editor} />
		</BlockNoteView>
	);
}
