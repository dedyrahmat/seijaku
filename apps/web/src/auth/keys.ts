import {
	fromBase64,
	isValidPhrase,
	newPhrase,
	newWorkspaceKey,
	phraseKeys,
	toBase64,
	unwrapWorkspaceKey,
	wrapWorkspaceKey,
} from "@seijaku/sync";
import { apiUrl } from "../workspace/syncUrl";

/**
 * The workspace key on this device, and the flows that make it, wrap it and open it.
 *
 * The key is kept in IndexedDB so the app opens offline. That protects notes from the
 * server, not from someone using this unlocked browser: the notes in this browser's storage
 * are not encrypted at rest.
 */

const DB = "seijaku-keys";
const STORE = "keys";
const KEY = "workspace";

function open(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB, 1);
		req.onupgradeneeded = () => req.result.createObjectStore(STORE);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

async function withStore<T>(
	mode: IDBTransactionMode,
	run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
	const db = await open();
	try {
		return await new Promise<T>((resolve, reject) => {
			const req = run(db.transaction(STORE, mode).objectStore(STORE));
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	} finally {
		db.close();
	}
}

export async function loadWorkspaceKey(): Promise<Uint8Array | null> {
	try {
		const found = await withStore<unknown>("readonly", (s) => s.get(KEY));
		return found instanceof Uint8Array ? found : null;
	} catch {
		return null;
	}
}

export async function saveWorkspaceKey(key: Uint8Array): Promise<void> {
	await withStore("readwrite", (s) => s.put(key, KEY));
}

/** Pulls the server's message out of a failed auth call. */
async function failure(res: Response, fallback: string): Promise<Error> {
	const body = (await res.json().catch(() => null)) as {
		message?: string;
	} | null;
	if (res.status === 429)
		return new Error("Too many tries. Wait a few minutes and try again.");
	return new Error(body?.message || fallback);
}

async function send(path: string, body?: unknown, method = "POST") {
	return fetch(apiUrl(`/api/auth/seijaku${path}`), {
		method,
		credentials: "include",
		headers: { "Content-Type": "application/json" },
		body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
	});
}

/** Creates an account with a fresh phrase and workspace key. Returns the phrase, to be shown once. */
export async function signUpWithPhrase(token: string): Promise<string> {
	const phrase = newPhrase();
	const workspaceKey = newWorkspaceKey();
	const { loginKey, wrapKey } = phraseKeys(phrase);
	const res = await send("/sign-up", {
		token: token || undefined,
		loginKey,
		wrapped: toBase64(wrapWorkspaceKey(wrapKey, workspaceKey)),
	});
	if (!res.ok)
		throw await failure(res, "The server did not accept the sign-up.");
	await saveWorkspaceKey(workspaceKey);
	return phrase;
}

/** After a passkey sign-up: makes the workspace key and the phrase that can restore it. Needs a session. */
export async function createPhraseForNewWorkspace(): Promise<string> {
	const workspaceKey = newWorkspaceKey();
	const phrase = await storePhrase(workspaceKey);
	await saveWorkspaceKey(workspaceKey);
	return phrase;
}

/** Makes a new phrase for the key this device holds; the old phrase stops working. */
export async function replacePhrase(): Promise<string> {
	const workspaceKey = await loadWorkspaceKey();
	if (!workspaceKey)
		throw new Error("Unlock this device with your phrase first.");
	return storePhrase(workspaceKey);
}

async function storePhrase(workspaceKey: Uint8Array): Promise<string> {
	const phrase = newPhrase();
	const { loginKey, wrapKey } = phraseKeys(phrase);
	const res = await send("/key-wraps", {
		kind: "phrase",
		loginKey,
		wrapped: toBase64(wrapWorkspaceKey(wrapKey, workspaceKey)),
	});
	if (!res.ok) throw await failure(res, "Could not save the new phrase.");
	return phrase;
}

/** Signs in with the phrase alone and opens the workspace key. */
export async function signInWithPhrase(input: string): Promise<void> {
	if (!isValidPhrase(input))
		throw new Error("That is not a valid recovery phrase. Check the words.");
	const { loginKey, wrapKey } = phraseKeys(input);
	const res = await send("/phrase", { loginKey });
	if (!res.ok) throw await failure(res, "That recovery phrase is not right.");
	const { wrapped } = (await res.json()) as { wrapped: string };
	await saveWorkspaceKey(unwrapWorkspaceKey(wrapKey, fromBase64(wrapped)));
}

/** Already signed in (by passkey) but this device has no key yet: open it with the phrase. */
export async function unlockWithPhrase(input: string): Promise<void> {
	if (!isValidPhrase(input))
		throw new Error("That is not a valid recovery phrase. Check the words.");
	const { wrapKey } = phraseKeys(input);
	const res = await send("/key-wraps", undefined, "GET");
	if (!res.ok) throw await failure(res, "Could not reach your server.");
	const wraps = (await res.json()) as { kind: string; wrapped: string }[];
	const phrase = wraps.find((w) => w.kind === "phrase");
	if (!phrase) throw new Error("This server has no recovery phrase on record.");
	try {
		await saveWorkspaceKey(
			unwrapWorkspaceKey(wrapKey, fromBase64(phrase.wrapped)),
		);
	} catch {
		throw new Error("That phrase does not open this workspace.");
	}
}
