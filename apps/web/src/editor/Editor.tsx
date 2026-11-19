import { syntaxHighlighter } from "@blocknote/code-block";
import {
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

/** BlockNote keys group headers by name, so items of one group must sit together. */
function keepGroupsTogether<T extends { group?: string }>(items: T[]): T[] {
	const order: (string | undefined)[] = [];
	for (const item of items) {
		if (!order.includes(item.group)) order.push(item.group);
	}
	return order.flatMap((g) => items.filter((item) => item.group === g));
}

interface Props {
	session: NoteSession;
	/** Lets the title field hand focus to the editor on Enter. */
	focusRef?: MutableRefObject<(() => void) | null>;
	/** Start with the cursor in the body (a new quick note). */
	autoFocus?: boolean;
}

export function Editor({ session, focusRef, autoFocus }: Props) {
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
			onChange={() => {
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
				getItems={async (query) =>
					filterSuggestionItems(
						keepGroupsTogether([
							...getDefaultReactSlashMenuItems(editor),
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
						]),
						query,
					)
				}
			/>
			<MobileToolbar editor={editor} />
		</BlockNoteView>
	);
}
