import {
	fromBase64,
	getWorkspaceName,
	openShare,
	type ShareInfo,
	sealShare,
	setShare,
	toBase64,
} from "@seijaku/sync";
import { authStore } from "../auth/session";
import { type Block, fragmentBlocks } from "../editor/headless";
import { i18n } from "../i18n";
import { readFile } from "./files";
import { workspace } from "./store";
import { apiUrl } from "./syncUrl";

/**
 * Sharing a page to the web. The page is published as a sealed copy under a random key that
 * lives only in the link's #fragment (browsers never send it to a server) and in the note's
 * own record, which syncs encrypted. The server hosts bytes it cannot read; revoking deletes
 * them. Images are embedded in the copy, so a shared page needs no other request.
 */

const MAX_FILE = 3 * 1024 * 1024;
const MAX_TOTAL = 12 * 1024 * 1024;
const MEDIA = new Set(["image", "video", "audio", "file"]);

/** The share key as it appears in the link: URL-safe base64, no padding. */
export const encodeKey = (key: Uint8Array): string => toBase64(key);
export const decodeKey = (text: string): Uint8Array => fromBase64(text);

/** The link to hand out. */
export function shareLink(share: ShareInfo): string {
	return `${location.origin}/share/${share.token}#${share.key}`;
}

interface Bundle {
	v: 1;
	title: string;
	/** The workspace's name when the page was published; older copies have none. */
	workspace?: string;
	blocks: Block[];
}

function bytesToDataUrl(type: string, bytes: Uint8Array): string {
	let s = "";
	for (const b of bytes) s += String.fromCharCode(b);
	return `data:${type};base64,${btoa(s)}`;
}

async function inlineFiles(
	blocks: Block[],
	budget: { left: number },
): Promise<Block[]> {
	const out: Block[] = [];
	for (const b of blocks) {
		let props = b.props;
		const url = String(b.props.url ?? "");
		if (MEDIA.has(b.type) && url.includes("/api/files/")) {
			const file = await readFile(url);
			const fits =
				file &&
				file.bytes.length <= MAX_FILE &&
				file.bytes.length <= budget.left;
			if (fits) {
				budget.left -= file.bytes.length;
				props = { ...props, url: bytesToDataUrl(file.type, file.bytes) };
			} else props = { ...props, url: "" }; // too big or unreadable: left out of the copy
		}
		out.push({ ...b, props, children: await inlineFiles(b.children, budget) });
	}
	return out;
}

async function publish(
	noteId: string,
	share: ShareInfo | null,
): Promise<ShareInfo> {
	const note = workspace.getNotes().find((n) => n.id === noteId);
	if (!note) throw new Error(i18n.t("errors.pageGone"));
	const key = share
		? decodeKey(share.key)
		: crypto.getRandomValues(new Uint8Array(32));
	const blocks = await workspace.withFragment(noteId, fragmentBlocks);
	const bundle: Bundle = {
		v: 1,
		title: note.title,
		workspace: getWorkspaceName(workspace.index) || undefined,
		blocks: await inlineFiles(blocks, { left: MAX_TOTAL }),
	};
	const sealed = sealShare(
		key,
		new TextEncoder().encode(JSON.stringify(bundle)),
	);
	const res = await fetch(apiUrl("/api/shares"), {
		method: "PUT",
		credentials: "include",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ token: share?.token, data: toBase64(sealed) }),
	});
	if (res.status === 401) throw new Error(i18n.t("errors.shareSignIn"));
	if (!res.ok) throw new Error(i18n.t("errors.noServerMoment"));
	const { token, createdAt } = (await res.json()) as {
		token: string;
		createdAt: number;
	};
	return {
		token,
		key: share?.key ?? encodeKey(key),
		at: share?.at ?? createdAt,
	};
}

export function canShare(): boolean {
	return authStore.getState().phase === "signed-in";
}

/** Turns sharing on: publishes the page and records the link on it. */
export async function startSharing(noteId: string): Promise<ShareInfo> {
	const share = await publish(noteId, null);
	setShare(workspace.index, noteId, share);
	return share;
}

/** Turns sharing off for good: the server deletes the copy, and the link stops working. */
export async function stopSharing(noteId: string): Promise<void> {
	const share = workspace.getNotes().find((n) => n.id === noteId)?.share;
	if (!share) return;
	const res = await fetch(apiUrl(`/api/shares/${share.token}`), {
		method: "DELETE",
		credentials: "include",
	});
	if (!res.ok) throw new Error(i18n.t("errors.noServerMoment"));
	setShare(workspace.index, noteId, null);
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** While a page is shared, edits are published again shortly after you stop typing. */
export function sharedNoteEdited(noteId: string): void {
	const share = workspace.getNotes().find((n) => n.id === noteId)?.share;
	if (!share || !canShare() || !authStore.getCipher()) return;
	clearTimeout(timers.get(noteId));
	timers.set(
		noteId,
		setTimeout(() => {
			timers.delete(noteId);
			void publish(noteId, share).catch(() => undefined);
		}, 8000),
	);
}

const SAFE_LINK = /^(https?:|mailto:)/i;
const SAFE_MEDIA = /^(https?:\/\/|data:(image|video|audio)\/)/i;

/**
 * A shared page comes from someone else, so it is read as data and cleaned before it is drawn:
 * links that are not web or mail links become plain text, and media must be a web address or
 * an embedded image, video or audio.
 */
export function cleanBlocks(node: unknown): unknown {
	if (Array.isArray(node)) {
		return node.flatMap((item) => {
			const o = item as { type?: string; href?: string; content?: unknown };
			if (o && o.type === "link" && !SAFE_LINK.test(String(o.href ?? "")))
				return cleanBlocks(o.content) as unknown[];
			return [cleanBlocks(item)];
		});
	}
	if (node && typeof node === "object") {
		return Object.fromEntries(
			Object.entries(node).map(([k, v]) => {
				if (k === "url" && typeof v === "string")
					return [k, v === "" || SAFE_MEDIA.test(v) ? v : ""];
				return [k, cleanBlocks(v)];
			}),
		);
	}
	return node;
}

/** What a link points at: the page's title and blocks, or null if it cannot be opened. */
export async function openShared(
	token: string,
	keyText: string,
): Promise<{ title: string; workspace: string; blocks: Block[] } | null> {
	try {
		const res = await fetch(apiUrl(`/api/shares/${token}`));
		if (!res.ok) return null;
		const plain = openShare(
			decodeKey(keyText),
			new Uint8Array(await res.arrayBuffer()),
		);
		const bundle = JSON.parse(new TextDecoder().decode(plain)) as Bundle;
		return {
			title: String(bundle.title ?? ""),
			workspace: String(bundle.workspace ?? "").slice(0, 60),
			blocks: cleanBlocks(bundle.blocks) as Block[],
		};
	} catch {
		return null;
	}
}
