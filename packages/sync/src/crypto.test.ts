import { expect, test } from "bun:test";
import { mnemonicToSeedSync } from "@scure/bip39";
import {
	createCipher,
	fromBase64,
	newWorkspaceKey,
	openShare,
	prfWrapKey,
	sealShare,
	toBase64,
	unwrapWorkspaceKey,
	wrapWorkspaceKey,
} from "./crypto";
import {
	isValidPhrase,
	newPhrase,
	normalisePhrase,
	phraseKeys,
} from "./phrase";

// The first BIP39 test vector (trezor/python-mnemonic): proves the words and seed are standard.
const VECTOR =
	"abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

test("the phrase follows BIP39", () => {
	const seed = mnemonicToSeedSync(VECTOR, "TREZOR");
	expect(Buffer.from(seed).toString("hex").startsWith("c55257c360c07c72")).toBe(
		true,
	);
	expect(isValidPhrase(VECTOR)).toBe(true);
});

test("a new phrase is twelve valid words", () => {
	const phrase = newPhrase();
	expect(phrase.split(" ").length).toBe(12);
	expect(isValidPhrase(phrase)).toBe(true);
	expect(newPhrase()).not.toBe(phrase);
});

test("typos, a wrong word count and made-up words are refused", () => {
	expect(isValidPhrase(VECTOR.replace("about", "abort"))).toBe(false);
	expect(isValidPhrase("abandon abandon abandon")).toBe(false);
	expect(isValidPhrase(VECTOR.replace("about", "zzzzz"))).toBe(false);
});

test("pasted phrases with numbering, commas and line breaks are accepted", () => {
	const messy = VECTOR.split(" ")
		.map((w, i) => `${i + 1}. ${w.toUpperCase()}`)
		.join(",\n");
	expect(normalisePhrase(messy)).toBe(VECTOR);
	expect(phraseKeys(messy).loginKey).toBe(phraseKeys(VECTOR).loginKey);
});

test("the login key and the wrapping key are different and stable", () => {
	const a = phraseKeys(VECTOR);
	const b = phraseKeys(VECTOR);
	expect(a.loginKey).toBe(b.loginKey);
	expect(toBase64(a.wrapKey)).toBe(toBase64(b.wrapKey));
	expect(a.loginKey).not.toBe(toBase64(a.wrapKey));
	expect(phraseKeys(newPhrase()).loginKey).not.toBe(a.loginKey);
});

test("the workspace key survives a wrap and unwrap, and only the right phrase opens it", () => {
	const wk = newWorkspaceKey();
	const wrapped = wrapWorkspaceKey(phraseKeys(VECTOR).wrapKey, wk);
	expect(unwrapWorkspaceKey(phraseKeys(VECTOR).wrapKey, wrapped)).toEqual(wk);
	expect(() =>
		unwrapWorkspaceKey(phraseKeys(newPhrase()).wrapKey, wrapped),
	).toThrow();
});

test("sealed data opens only for the same doc and key, and is different each time", () => {
	const cipher = createCipher(newWorkspaceKey());
	const plain = new TextEncoder().encode("hello");
	const a = cipher.seal("note-1", plain);
	expect(a).not.toEqual(cipher.seal("note-1", plain));
	expect(cipher.open("note-1", a)).toEqual(plain);
	expect(() => cipher.open("note-2", a)).toThrow();
	expect(() => createCipher(newWorkspaceKey()).open("note-1", a)).toThrow();
});

test("server doc ids hide the local id and are stable", () => {
	const wk = newWorkspaceKey();
	const a = createCipher(wk);
	const b = createCipher(wk);
	expect(a.remoteId("daily-2026-11-16")).toBe(b.remoteId("daily-2026-11-16"));
	expect(a.remoteId("daily-2026-11-16")).toMatch(/^d[a-f0-9]{32}$/);
	expect(a.remoteId("note-1")).not.toBe(a.remoteId("note-2"));
	expect(createCipher(newWorkspaceKey()).remoteId("note-1")).not.toBe(
		a.remoteId("note-1"),
	);
});

test("files keep their name and type inside the sealed bytes", () => {
	const cipher = createCipher(newWorkspaceKey());
	const bytes = new Uint8Array([1, 2, 3, 4, 5]);
	const blob = cipher.sealFile({
		name: "plan.pdf",
		type: "application/pdf",
		bytes,
	});
	expect(Buffer.from(blob).toString("latin1")).not.toContain("plan.pdf");
	const back = cipher.openFile(blob);
	expect(back.name).toBe("plan.pdf");
	expect(back.type).toBe("application/pdf");
	expect(back.bytes).toEqual(bytes);
	expect(fromBase64(toBase64(bytes))).toEqual(bytes);
});

test("a passkey's PRF output wraps the workspace key, and only the same output opens it", () => {
	const wk = newWorkspaceKey();
	const prf = crypto.getRandomValues(new Uint8Array(32));
	const wrapped = wrapWorkspaceKey(prfWrapKey(prf), wk);
	expect(unwrapWorkspaceKey(prfWrapKey(prf), wrapped)).toEqual(wk);
	expect(() =>
		unwrapWorkspaceKey(
			prfWrapKey(crypto.getRandomValues(new Uint8Array(32))),
			wrapped,
		),
	).toThrow();
});

test("a shared page opens with its link key and with nothing else", () => {
	const key = newWorkspaceKey();
	const page = new TextEncoder().encode('{"title":"hi"}');
	const sealed = sealShare(key, page);
	expect(openShare(key, sealed)).toEqual(page);
	expect(() => openShare(newWorkspaceKey(), sealed)).toThrow();
	// The workspace's own sealing cannot be passed off as a share, or the reverse.
	expect(() => unwrapWorkspaceKey(key, sealed)).toThrow();
});
