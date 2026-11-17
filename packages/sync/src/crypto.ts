import { gcm } from "@noble/ciphers/aes.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

/**
 * End-to-end encryption primitives. One 256-bit workspace key never leaves the devices
 * unwrapped; everything the server stores is sealed with a key derived from it.
 *
 * Synchronous on purpose (noble, not WebCrypto): the sync client must encrypt updates in
 * the order they happen, and an async cipher would make that ordering fragile.
 */

export const WORKSPACE_KEY_BYTES = 32;
const NONCE_BYTES = 12;

export interface Cipher {
	/**
	 * The name the server knows a doc by: an HMAC of the local id, so `daily-2026-11-16`
	 * and note ids are not visible to it. Matches the server's `isValidDocId`.
	 */
	remoteId(localId: string): string;
	/** Encrypts one update or snapshot of a doc. The local id is bound in as authenticated data. */
	seal(localId: string, plain: Uint8Array): Uint8Array;
	/** Throws if the blob was not sealed with this key for this doc, or was altered. */
	open(localId: string, blob: Uint8Array): Uint8Array;
	/** For files: sealed with a key of their own, with the name and type inside. */
	sealFile(file: { name: string; type: string; bytes: Uint8Array }): Uint8Array;
	openFile(blob: Uint8Array): { name: string; type: string; bytes: Uint8Array };
}

function derive(key: Uint8Array, salt: string, info: string): Uint8Array {
	return hkdf(sha256, key, utf8ToBytes(salt), utf8ToBytes(info), 32);
}

function randomBytes(n: number): Uint8Array {
	const out = new Uint8Array(n);
	crypto.getRandomValues(out);
	return out;
}

function seal(key: Uint8Array, aad: string, plain: Uint8Array): Uint8Array {
	const nonce = randomBytes(NONCE_BYTES);
	const sealed = gcm(key, nonce, utf8ToBytes(aad)).encrypt(plain);
	const out = new Uint8Array(NONCE_BYTES + sealed.length);
	out.set(nonce, 0);
	out.set(sealed, NONCE_BYTES);
	return out;
}

function open(key: Uint8Array, aad: string, blob: Uint8Array): Uint8Array {
	if (blob.length < NONCE_BYTES + 16) throw new Error("sealed data too short");
	return gcm(key, blob.subarray(0, NONCE_BYTES), utf8ToBytes(aad)).decrypt(
		blob.subarray(NONCE_BYTES),
	);
}

export function newWorkspaceKey(): Uint8Array {
	return randomBytes(WORKSPACE_KEY_BYTES);
}

export function createCipher(workspaceKey: Uint8Array): Cipher {
	if (workspaceKey.length !== WORKSPACE_KEY_BYTES)
		throw new Error("workspace key must be 32 bytes");
	const idKey = derive(workspaceKey, "seijaku/v1", "doc-id");
	const fileKey = derive(workspaceKey, "seijaku/v1", "file");
	const docKeys = new Map<string, Uint8Array>();
	const ids = new Map<string, string>();
	const docKey = (localId: string) => {
		let k = docKeys.get(localId);
		if (!k) {
			k = derive(workspaceKey, "seijaku/v1/doc", localId);
			docKeys.set(localId, k);
		}
		return k;
	};

	return {
		remoteId(localId) {
			let id = ids.get(localId);
			if (!id) {
				id = `d${bytesToHex(hmac(sha256, idKey, utf8ToBytes(localId))).slice(0, 32)}`;
				ids.set(localId, id);
			}
			return id;
		},
		seal: (localId, plain) => seal(docKey(localId), localId, plain),
		open: (localId, blob) => open(docKey(localId), localId, blob),
		sealFile({ name, type, bytes }) {
			const head = utf8ToBytes(JSON.stringify({ name, type }));
			const plain = new Uint8Array(4 + head.length + bytes.length);
			new DataView(plain.buffer).setUint32(0, head.length);
			plain.set(head, 4);
			plain.set(bytes, 4 + head.length);
			return seal(fileKey, "file", plain);
		},
		openFile(blob) {
			const plain = open(fileKey, "file", blob);
			const headLength = new DataView(
				plain.buffer,
				plain.byteOffset,
				plain.byteLength,
			).getUint32(0);
			const head = JSON.parse(
				new TextDecoder().decode(plain.subarray(4, 4 + headLength)),
			) as { name: string; type: string };
			return { ...head, bytes: plain.subarray(4 + headLength) };
		},
	};
}

/** The wrapping key for a passkey, made from the 32 bytes its WebAuthn PRF extension returns. */
export function prfWrapKey(prfOutput: Uint8Array): Uint8Array {
	return derive(prfOutput, "seijaku/passkey/v1", "wrap");
}

/**
 * A shared page is sealed under a random key of its own, which travels only in the link's
 * #fragment (browsers never send it to the server). Anyone with the link can read it; the
 * server cannot.
 */
export function sealShare(shareKey: Uint8Array, plain: Uint8Array): Uint8Array {
	return seal(shareKey, "share", plain);
}

export function openShare(shareKey: Uint8Array, blob: Uint8Array): Uint8Array {
	return open(shareKey, "share", blob);
}

/** Wraps the workspace key under a key made from a phrase or a passkey; safe to store on the server. */
export function wrapWorkspaceKey(
	wrapKey: Uint8Array,
	workspaceKey: Uint8Array,
): Uint8Array {
	return seal(wrapKey, "workspace-key", workspaceKey);
}

export function unwrapWorkspaceKey(
	wrapKey: Uint8Array,
	wrapped: Uint8Array,
): Uint8Array {
	return open(wrapKey, "workspace-key", wrapped);
}

export function toBase64(bytes: Uint8Array): string {
	let s = "";
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64(text: string): Uint8Array {
	const pad = "=".repeat((4 - (text.length % 4)) % 4);
	const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/") + pad);
	return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
