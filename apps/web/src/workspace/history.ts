import { countWords, fragmentText, noteDocId } from "@seijaku/sync";
import * as Y from "yjs";
import { authStore } from "../auth/session";
import { type Block, fragmentBlocks } from "../editor/headless";
import { getPrefs } from "../preferences";
import { workspace } from "./store";
import { apiUrl } from "./syncUrl";

/**
 * Version history. A snapshot is a note's whole Yjs state, sealed on this device and kept by
 * the server, which can list and thin snapshots but never open one. Restoring writes an old
 * snapshot's content into the live note as an ordinary edit, so it syncs and can be undone.
 */

const IDLE_MS = 2 * 60_000;
const DEVICE_KEY = "seijaku:device";

/** A random id for this browser, so a list can say "this device" or "another device". */
function deviceId(): string {
	try {
		let id = localStorage.getItem(DEVICE_KEY);
		if (!id) {
			id = crypto.randomUUID();
			localStorage.setItem(DEVICE_KEY, id);
		}
		return id;
	} catch {
		return "unknown";
	}
}

interface VersionMeta {
	words: number;
	device: string;
}

export interface VersionEntry {
	id: string;
	at: number;
	words: number;
	/** Made on this browser. */
	here: boolean;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const b64 = (bytes: Uint8Array): string => {
	let s = "";
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s);
};
const unb64 = (text: string): Uint8Array =>
	Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** What the server calls this note: only the owner can map it back. */
function remoteDoc(noteId: string): string | null {
	return authStore.getCipher()?.remoteId(noteDocId(noteId)) ?? null;
}

function ready(): boolean {
	return authStore.getState().phase === "signed-in" && !!authStore.getCipher();
}

const keepDays = (): number | null => {
	const v = getPrefs().historyFor;
	return v === "30 days" ? 30 : v === "90 days" ? 90 : null;
};

/** The state last sent from this tab, so opening the panel twice does not pile up identical versions. */
const lastSent = new Map<string, string>();

/** Seals this note's current state and sends it. Quietly does nothing when signed out or offline. */
export async function saveSnapshot(noteId: string): Promise<void> {
	const cipher = authStore.getCipher();
	const doc = remoteDoc(noteId);
	if (!ready() || !cipher || !doc) return;
	const { state, words, vector } = await workspace.withFragment(
		noteId,
		(fragment) => ({
			state: Y.encodeStateAsUpdate(fragment.doc as Y.Doc),
			vector: b64(Y.encodeStateVector(fragment.doc as Y.Doc)),
			words: countWords(fragmentText(fragment)),
		}),
	);
	if (lastSent.get(noteId) === vector) return;
	const meta: VersionMeta = { words, device: deviceId() };
	try {
		await fetch(apiUrl("/api/versions"), {
			method: "POST",
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				doc,
				meta: b64(
					cipher.seal(
						`version-meta:${noteId}`,
						encoder.encode(JSON.stringify(meta)),
					),
				),
				data: b64(cipher.seal(`version:${noteId}`, state)),
				keepDays: keepDays(),
			}),
		});
		lastSent.set(noteId, vector);
	} catch {
		// Offline: the next idle moment tries again.
	}
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Call on every edit: a snapshot is taken once the note has been quiet for a couple of minutes. */
export function noteEdited(noteId: string): void {
	clearTimeout(timers.get(noteId));
	timers.set(
		noteId,
		setTimeout(() => {
			timers.delete(noteId);
			void saveSnapshot(noteId);
		}, IDLE_MS),
	);
}

/** Leaving a note: take the pending snapshot now instead of waiting. */
export function flushSnapshot(noteId: string): void {
	if (!timers.has(noteId)) return;
	clearTimeout(timers.get(noteId));
	timers.delete(noteId);
	void saveSnapshot(noteId);
}

/** Newest first. Throws when the server cannot be reached. */
export async function listVersions(noteId: string): Promise<VersionEntry[]> {
	const cipher = authStore.getCipher();
	const doc = remoteDoc(noteId);
	if (!cipher || !doc) return [];
	const res = await fetch(apiUrl(`/api/versions?doc=${doc}`), {
		credentials: "include",
	});
	if (!res.ok) throw new Error(String(res.status));
	const rows = (await res.json()) as {
		id: string;
		createdAt: number;
		meta: string;
	}[];
	const me = deviceId();
	const out: VersionEntry[] = [];
	for (const row of rows) {
		try {
			const meta = JSON.parse(
				decoder.decode(cipher.open(`version-meta:${noteId}`, unb64(row.meta))),
			) as VersionMeta;
			out.push({
				id: row.id,
				at: row.createdAt,
				words: meta.words,
				here: meta.device === me,
			});
		} catch {
			// Made under another key, or damaged: not listed.
		}
	}
	return out;
}

/** A snapshot as a standalone doc, ready to read. */
async function openVersion(noteId: string, id: string): Promise<Y.Doc> {
	const cipher = authStore.getCipher();
	if (!cipher) throw new Error("locked");
	const res = await fetch(apiUrl(`/api/versions/${id}`), {
		credentials: "include",
	});
	if (!res.ok) throw new Error(String(res.status));
	const doc = new Y.Doc();
	Y.applyUpdate(
		doc,
		cipher.open(`version:${noteId}`, new Uint8Array(await res.arrayBuffer())),
	);
	return doc;
}

/** The blocks of one snapshot, for a read-only preview. */
export async function versionBlocks(
	noteId: string,
	id: string,
): Promise<Block[]> {
	const doc = await openVersion(noteId, id);
	try {
		return fragmentBlocks(doc.getXmlFragment("blocknote"));
	} finally {
		doc.destroy();
	}
}

/**
 * Puts an old snapshot's content into the live note as one edit. The current state is
 * snapshotted first, so the restore itself can be undone from the list.
 */
export async function restoreVersion(
	noteId: string,
	id: string,
): Promise<void> {
	await saveSnapshot(noteId);
	const old = await openVersion(noteId, id);
	try {
		await workspace.withFragment(noteId, (fragment) => {
			const source = old.getXmlFragment("blocknote");
			(fragment.doc as Y.Doc).transact(() => {
				fragment.delete(0, fragment.length);
				fragment.insert(
					0,
					source
						.toArray()
						.map((node) => node.clone() as Y.XmlElement | Y.XmlText),
				);
			});
		});
	} finally {
		old.destroy();
	}
}
