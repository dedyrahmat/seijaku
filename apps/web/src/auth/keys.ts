import {
	fromBase64,
	isValidPhrase,
	newPhrase,
	newWorkspaceKey,
	phraseKeys,
	prfWrapKey,
	toBase64,
	unwrapWorkspaceKey,
	wrapWorkspaceKey,
} from "@seijaku/sync";
import { i18n } from "../i18n";
import { apiUrl } from "../workspace/syncUrl";
import { authClient } from "./client";

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

/** Signing out also forgets the key: it belongs to the account, and the next one may differ. */
export async function clearWorkspaceKey(): Promise<void> {
	await withStore("readwrite", (s) => s.delete(KEY)).catch(() => undefined);
}

/** Pulls the server's message out of a failed auth call. */
async function failure(res: Response, fallback: string): Promise<Error> {
	const body = (await res.json().catch(() => null)) as {
		message?: string;
	} | null;
	if (res.status === 429) return new Error(i18n.t("errors.tooMany"));
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

/**
 * After a passkey sign-up: makes the workspace key and the phrase that can restore it, and
 * lets the passkey open the key on other devices when it can. Needs a session.
 */
export async function createPhraseForNewWorkspace(
	passkey?: PasskeyResult,
): Promise<string> {
	const workspaceKey = newWorkspaceKey();
	const phrase = await storePhrase(workspaceKey);
	if (passkey) await wrapForPasskey(passkey, workspaceKey);
	await saveWorkspaceKey(workspaceKey);
	return phrase;
}

/**
 * Passkeys open the notes by themselves through the WebAuthn PRF extension: the authenticator
 * turns a fixed salt into 32 secret bytes that only that passkey can make. Not every passkey
 * supports it; without a result the phrase is asked for once per device instead.
 */
const PRF_SALT = new TextEncoder().encode("seijaku/passkey-prf/v1");
const PRF_EXTENSION = { prf: { eval: { first: PRF_SALT } } };

export interface PasskeyResult {
	credentialId: string;
	/** The authenticator's PRF output, or null when it gave none. */
	prf: Uint8Array | null;
}

interface WebAuthnReply {
	error?: { message?: string } | null;
	webauthn?: {
		response: { id: string };
		clientExtensionResults?: {
			prf?: { results?: { first?: ArrayBuffer | Uint8Array } };
		};
	};
}

function passkeyResult(res: WebAuthnReply, failed: string): PasskeyResult {
	if (res.error || !res.webauthn)
		throw new Error(res.error?.message?.trim() || failed);
	const first = res.webauthn.clientExtensionResults?.prf?.results?.first;
	return {
		credentialId: res.webauthn.response.id,
		prf: first ? new Uint8Array(first as ArrayBuffer) : null,
	};
}

/** Makes a passkey on this device (signing up too when `createSession`). Throws with a readable message. */
export async function registerPasskey(opts: {
	name: string;
	context?: string;
	createSession?: boolean;
}): Promise<PasskeyResult> {
	const res = (await authClient().passkey.addPasskey({
		...opts,
		extensions: PRF_EXTENSION as never,
		returnWebAuthnResponse: true,
	})) as WebAuthnReply;
	return passkeyResult(res, "The passkey could not be made.");
}

/** Signs in with a passkey. Throws with a readable message. */
export async function authenticatePasskey(): Promise<PasskeyResult> {
	const res = (await authClient().signIn.passkey({
		extensions: PRF_EXTENSION as never,
		returnWebAuthnResponse: true,
	})) as WebAuthnReply;
	return passkeyResult(res, "That passkey was not accepted.");
}

/** Stores the workspace key wrapped for this passkey, so it opens the notes on any device. */
export async function wrapForPasskey(
	passkey: PasskeyResult,
	workspaceKey: Uint8Array,
): Promise<void> {
	if (!passkey.prf) return;
	const res = await send("/key-wraps", {
		kind: "passkey",
		ref: passkey.credentialId,
		wrapped: toBase64(wrapWorkspaceKey(prfWrapKey(passkey.prf), workspaceKey)),
	});
	if (!res.ok) throw await failure(res, "Could not save the passkey's key.");
}

/** Signed in with a passkey on a device with no key: opens it if this passkey has a wrap. */
export async function openWithPasskey(
	passkey: PasskeyResult,
): Promise<boolean> {
	if (!passkey.prf) return false;
	const res = await send("/key-wraps", undefined, "GET");
	if (!res.ok) return false;
	const wraps = (await res.json()) as {
		kind: string;
		ref: string;
		wrapped: string;
	}[];
	const mine = wraps.find(
		(w) => w.kind === "passkey" && w.ref === passkey.credentialId,
	);
	if (!mine) return false;
	try {
		await saveWorkspaceKey(
			unwrapWorkspaceKey(prfWrapKey(passkey.prf), fromBase64(mine.wrapped)),
		);
		return true;
	} catch {
		return false;
	}
}

/** For a passkey added from Settings while signed in and unlocked. */
export async function wrapHeldKeyForPasskey(
	passkey: PasskeyResult,
): Promise<void> {
	const key = await loadWorkspaceKey();
	if (key) await wrapForPasskey(passkey, key);
}

/** Makes a new phrase for the key this device holds; the old phrase stops working. */
export async function replacePhrase(): Promise<string> {
	const workspaceKey = await loadWorkspaceKey();
	if (!workspaceKey) throw new Error(i18n.t("errors.unlockFirst"));
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
	if (!isValidPhrase(input)) throw new Error(i18n.t("errors.badPhrase"));
	const { loginKey, wrapKey } = phraseKeys(input);
	const res = await send("/phrase", { loginKey });
	if (!res.ok) throw await failure(res, "That recovery phrase is not right.");
	const { wrapped } = (await res.json()) as { wrapped: string };
	await saveWorkspaceKey(unwrapWorkspaceKey(wrapKey, fromBase64(wrapped)));
}

/** Already signed in (by passkey) but this device has no key yet: open it with the phrase. */
export async function unlockWithPhrase(input: string): Promise<void> {
	if (!isValidPhrase(input)) throw new Error(i18n.t("errors.badPhrase"));
	const { wrapKey } = phraseKeys(input);
	const res = await send("/key-wraps", undefined, "GET");
	if (!res.ok) throw await failure(res, "Could not reach your server.");
	const wraps = (await res.json()) as { kind: string; wrapped: string }[];
	const phrase = wraps.find((w) => w.kind === "phrase");
	if (!phrase) throw new Error(i18n.t("errors.noPhrase"));
	try {
		await saveWorkspaceKey(
			unwrapWorkspaceKey(wrapKey, fromBase64(phrase.wrapped)),
		);
	} catch {
		throw new Error(i18n.t("errors.wrongPhrase"));
	}
}
