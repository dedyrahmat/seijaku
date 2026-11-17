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
import { authStore } from "../auth/session";
import { useColorScheme } from "../theme";
import type { NoteSession } from "../workspace/store";
import { workspace } from "../workspace/store";
import { apiUrl } from "../workspace/syncUrl";
import { schema } from "./schema";

/**
 * Seals a picked, pasted or dropped file on this device and sends only the sealed bytes: the
 * server stores a blob it cannot read, and the name and type travel inside it.
 */
async function uploadFile(file: File): Promise<string> {
	const cipher = authStore.getCipher();
	if (authStore.getState().phase === "signed-out")
		throw new Error("Sign in to add files.");
	if (!cipher) throw new Error("Unlock this device before adding files.");
	const sealed = cipher.sealFile({
		name: file.name,
		type: file.type || "application/octet-stream",
		bytes: new Uint8Array(await file.arrayBuffer()),
	});
	const res = await fetch(apiUrl("/api/files"), {
		method: "POST",
		credentials: "include",
		headers: { "Content-Type": "application/octet-stream" },
		body: new Blob([sealed as BlobPart]),
	});
	if (res.status === 413) throw new Error("That file is larger than 25 MB.");
	if (!res.ok)
		throw new Error("Could not upload. Check your connection and try again.");
	const { url } = (await res.json()) as { url: string };
	return apiUrl(url);
}

const opened = new Map<string, Promise<string>>();

/** Downloads a sealed file, opens it here, and hands the editor a local address for it. */
function resolveFileUrl(url: string): Promise<string> {
	if (!url.includes("/api/files/")) return Promise.resolve(url);
	let found = opened.get(url);
	if (!found) {
		found = (async () => {
			const cipher = authStore.getCipher();
			if (!cipher) return url;
			const res = await fetch(url, { credentials: "include" });
			if (!res.ok) return url;
			try {
				const file = cipher.openFile(new Uint8Array(await res.arrayBuffer()));
				return URL.createObjectURL(
					new Blob([file.bytes as BlobPart], { type: file.type }),
				);
			} catch {
				// Uploaded before notes were encrypted: the address itself still works.
				return url;
			}
		})();
		opened.set(url, found);
	}
	return found;
}

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
}

export function Editor({ session, focusRef }: Props) {
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
		if (!focusRef) return;
		focusRef.current = () => editor.focus();
		return () => {
			focusRef.current = null;
		};
	}, [editor, focusRef]);

	useEffect(() => () => clearTimeout(touchTimer.current), []);

	return (
		<BlockNoteView
			editor={editor}
			theme={scheme}
			slashMenu={false}
			onChange={() => {
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
		</BlockNoteView>
	);
}
