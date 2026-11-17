import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import {
	generateMnemonic,
	mnemonicToSeedSync,
	validateMnemonic,
} from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { toBase64 } from "./crypto";

/**
 * The recovery phrase: twelve words, made the way a crypto wallet makes them (BIP39).
 * It is the one secret a person has to keep. From it come two independent keys:
 * a login key (proves to the server who is signing in) and a wrapping key (opens the
 * workspace key). The server only ever sees the login key, and only a hash of it.
 */

export const PHRASE_WORDS = 12;

export function newPhrase(): string {
	return generateMnemonic(wordlist, 128);
}

/** Lowercase, single spaces. Pasted phrases arrive with line breaks, numbers or stray spaces. */
export function normalisePhrase(input: string): string {
	return input
		.toLowerCase()
		.replace(/[^a-z\s]/g, " ")
		.split(/\s+/)
		.filter(Boolean)
		.join(" ");
}

export function isValidPhrase(input: string): boolean {
	const phrase = normalisePhrase(input);
	return (
		phrase.split(" ").length === PHRASE_WORDS &&
		validateMnemonic(phrase, wordlist)
	);
}

export interface PhraseKeys {
	/** Sent to the server to sign in; it keeps only a hash. */
	loginKey: string;
	/** Never leaves the device; wraps the workspace key. */
	wrapKey: Uint8Array;
}

export function phraseKeys(input: string): PhraseKeys {
	const phrase = normalisePhrase(input);
	if (!isValidPhrase(phrase)) throw new Error("not a valid recovery phrase");
	const seed = mnemonicToSeedSync(phrase);
	const derive = (info: string) =>
		hkdf(sha256, seed, utf8ToBytes("seijaku/phrase/v1"), utf8ToBytes(info), 32);
	return { loginKey: toBase64(derive("login")), wrapKey: derive("wrap") };
}
