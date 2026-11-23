import { authStore } from "../auth/session";
import { i18n } from "../i18n";
import { apiUrl } from "./syncUrl";

/**
 * Attachments, sealed on this device. A file's address is the hash of its sealed bytes, so a
 * file added offline already has its final address: the note refers to it at once, the bytes
 * wait in a queue (Cache API) and are sent when the server is reachable again. Every file seen
 * or added is also kept in a cache, so images still show offline.
 */

const FILES = "seijaku-files";
const QUEUE = "seijaku-file-queue";

async function addressOf(sealed: Uint8Array): Promise<string> {
	const digest = new Uint8Array(
		await crypto.subtle.digest("SHA-256", sealed as BufferSource),
	);
	return Array.from(digest.subarray(0, 12), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
}

/** The Cache API exists only in secure contexts; without it files work online only. */
async function open(name: string): Promise<Cache | null> {
	try {
		return (await globalThis.caches?.open(name)) ?? null;
	} catch {
		return null;
	}
}

/** Attachments still waiting for the server. */
export async function queuedUploads(): Promise<number> {
	const queue = await open(QUEUE);
	return queue ? (await queue.keys()).length : 0;
}

function put(url: string, sealed: Uint8Array): Promise<Response> {
	return fetch(url, {
		method: "PUT",
		credentials: "include",
		headers: { "Content-Type": "application/octet-stream" },
		body: new Blob([sealed as BlobPart]),
	});
}

/**
 * Seals a picked, pasted or dropped file on this device and uploads only the sealed bytes: the
 * server stores a blob it cannot read, and the name and type travel inside it. Offline, the
 * upload is queued and the address is returned anyway.
 */
export async function uploadFile(file: File): Promise<string> {
	if (authStore.getState().phase === "signed-out")
		throw new Error(i18n.t("errors.fileSignIn"));
	const cipher = authStore.getCipher();
	if (!cipher) throw new Error(i18n.t("errors.fileUnlock"));
	const sealed = cipher.sealFile({
		name: file.name,
		type: file.type || "application/octet-stream",
		bytes: new Uint8Array(await file.arrayBuffer()),
	});
	const url = apiUrl(`/api/files/${await addressOf(sealed)}`);
	await (await open(FILES))?.put(url, new Response(sealed as BlobPart));

	let res: Response | null = null;
	try {
		res = await put(url, sealed);
	} catch {
		// Offline or the server is down: queued below.
	}
	if (res?.ok) return url;
	if (res?.status === 413) {
		const body = (await res.json().catch(() => null)) as {
			error?: string;
			limit?: number;
		} | null;
		throw new Error(
			body?.error === "quota"
				? i18n.t("errors.quotaFiles", {
						size: `${Math.round((body.limit ?? 0) / 1048576)} MB`,
					})
				: i18n.t("errors.fileTooBig"),
		);
	}
	if (res && res.status < 500 && res.status !== 401)
		throw new Error(i18n.t("errors.uploadFailed"));

	const queue = await open(QUEUE);
	if (!queue) throw new Error(i18n.t("errors.uploadOffline"));
	await queue.put(url, new Response(sealed as BlobPart));
	return url;
}

let flushing = false;

/** Sends what was added while offline. Safe to call often. */
export async function flushUploads(): Promise<void> {
	if (flushing || authStore.getState().phase !== "signed-in") return;
	const queue = await open(QUEUE);
	if (!queue) return;
	flushing = true;
	try {
		for (const request of await queue.keys()) {
			const stored = await queue.match(request);
			if (!stored) continue;
			let res: Response;
			try {
				res = await put(
					request.url,
					new Uint8Array(await stored.arrayBuffer()),
				);
			} catch {
				return; // still offline: try again later
			}
			// Done, or refused for good (too large, bad address): either way it leaves the queue.
			if (res.ok || (res.status < 500 && res.status !== 401))
				await queue.delete(request);
			else return;
		}
	} finally {
		flushing = false;
	}
}

/** Starts sending queued uploads whenever the device may be able to. */
export function startFileQueue(): void {
	void flushUploads();
	window.addEventListener("online", () => void flushUploads());
	authStore.subscribe(() => void flushUploads());
	setInterval(() => void flushUploads(), 30_000);
}

export interface OpenedFile {
	name: string;
	type: string;
	bytes: Uint8Array;
}

/** Gets a sealed file (from the cache, else the server) and opens it; null if it cannot be opened here. */
export async function readFile(url: string): Promise<OpenedFile | null> {
	const cipher = authStore.getCipher();
	if (!cipher) return null;
	const cache = await open(FILES);
	let sealed = await cache?.match(url);
	if (!sealed) {
		const res = await fetch(url, { credentials: "include" }).catch(() => null);
		if (!res?.ok) return null;
		await cache?.put(url, res.clone());
		sealed = res;
	}
	try {
		return cipher.openFile(new Uint8Array(await sealed.arrayBuffer()));
	} catch {
		return null; // uploaded before notes were encrypted
	}
}

const opened = new Map<string, Promise<string>>();

/** A local address for a sealed file, for the editor to show. Falls back to the file's own address. */
export function resolveFileUrl(url: string): Promise<string> {
	if (!url.includes("/api/files/")) return Promise.resolve(url);
	let found = opened.get(url);
	if (!found) {
		found = readFile(url).then((file) =>
			file
				? URL.createObjectURL(
						new Blob([file.bytes as BlobPart], { type: file.type }),
					)
				: url,
		);
		opened.set(url, found);
		// A failed look-up must not stick: the next render tries again.
		void found.then((u) => u === url && opened.delete(url));
	}
	return found;
}
