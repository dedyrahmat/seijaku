import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	newPhrase,
	newWorkspaceKey,
	phraseKeys,
	toBase64,
	wrapWorkspaceKey,
} from "@seijaku/sync";
import { openAuth, openStore, startServer } from "./bun";

const stops: (() => void)[] = [];
afterEach(() => {
	for (const stop of stops.splice(0)) stop();
});

async function boot() {
	const dir = mkdtempSync(join(tmpdir(), "seijaku-account-"));
	const dbPath = join(dir, "db.sqlite");
	const blobDir = join(dir, "blobs");
	const auth = await openAuth(dbPath, {}, 0);
	const store = openStore(dbPath);
	const { server } = startServer({ port: 0, store, blobDir, auth });
	stops.push(() => server.stop(true));
	return { base: `http://localhost:${server.port}`, dbPath, blobDir, store };
}

const json = {
	Origin: "http://localhost:5173",
	"Content-Type": "application/json",
};

async function signUp(base: string) {
	const keys = phraseKeys(newPhrase());
	const res = await fetch(`${base}/api/auth/seijaku/sign-up`, {
		method: "POST",
		headers: json,
		body: JSON.stringify({
			loginKey: keys.loginKey,
			wrapped: toBase64(wrapWorkspaceKey(keys.wrapKey, newWorkspaceKey())),
		}),
	});
	const cookie = res.headers
		.getSetCookie()
		.map((c) => c.split(";")[0])
		.join("; ");
	return { cookie, loginKey: keys.loginKey };
}

const call = (base: string, path: string, cookie: string, init: RequestInit) =>
	fetch(`${base}${path}`, {
		...init,
		headers: { ...json, Cookie: cookie },
	});

test("deleting an account removes everything the server holds for it, and only with proof", async () => {
	const { base, dbPath, blobDir, store } = await boot();
	const alice = await signUp(base);
	const bob = await signUp(base);

	const raw = new Database(dbPath);
	const ids = raw.query("SELECT id FROM user ORDER BY rowid").all() as {
		id: string;
	}[];
	const aliceId = ids[0]?.id as string;
	const bobId = ids[1]?.id as string;
	store(aliceId).append("d1", new Uint8Array([1]));
	store(bobId).append("d1", new Uint8Array([2]));

	const upload = async (who: { cookie: string }, byte: number) => {
		const res = await call(base, "/api/files", who.cookie, {
			method: "POST",
			headers: { Cookie: who.cookie, "Content-Type": "image/png" },
			body: new Uint8Array([byte, 1, 2]),
		});
		return ((await res.json()) as { id: string }).id;
	};
	const aliceFile = await upload(alice, 1);
	const bobFile = await upload(bob, 2);
	const share = await call(base, "/api/shares", alice.cookie, {
		method: "PUT",
		body: JSON.stringify({ data: "AQID" }),
	});
	const { token } = (await share.json()) as { token: string };
	await call(base, "/api/versions", alice.cookie, {
		method: "POST",
		body: JSON.stringify({
			doc: `d${"a".repeat(32)}`,
			meta: "m",
			data: "AQID",
		}),
	});

	// Wrong proof, and a session alone, delete nothing.
	const wrong = await call(base, "/api/account", alice.cookie, {
		method: "DELETE",
		body: JSON.stringify({ loginKey: bob.loginKey }),
	});
	expect(wrong.status).toBe(403);
	expect(existsSync(join(blobDir, aliceFile))).toBe(true);
	expect(
		(await call(base, "/api/account", "", { method: "DELETE", body: "{}" }))
			.status,
	).toBe(401);

	const done = await call(base, "/api/account", alice.cookie, {
		method: "DELETE",
		body: JSON.stringify({ loginKey: alice.loginKey }),
	});
	expect(done.status).toBe(200);

	expect(existsSync(join(blobDir, aliceFile))).toBe(false);
	expect((await fetch(`${base}/api/shares/${token}`)).status).toBe(404);
	expect((await store(aliceId).stat("d1")).count).toBe(0);
	const left = (table: string) =>
		(
			raw
				.query(`SELECT count(*) AS n FROM ${table} WHERE user_id = ?`)
				.get(aliceId) as {
				n: number;
			}
		).n;
	for (const table of ["key_wrap", "doc_version", "share_link", "blob_owner"])
		expect(left(table)).toBe(0);
	expect(raw.query("SELECT id FROM user WHERE id = ?").get(aliceId)).toBeNull();
	expect(
		raw.query("SELECT id FROM session WHERE userId = ?").get(aliceId),
	).toBeNull();
	// The phrase no longer signs in, and her old session is dead.
	const again = await fetch(`${base}/api/auth/seijaku/phrase`, {
		method: "POST",
		headers: json,
		body: JSON.stringify({ loginKey: alice.loginKey }),
	});
	expect(again.status).toBe(401);
	expect(
		(await call(base, `/api/files/${bobFile}`, alice.cookie, { method: "GET" }))
			.status,
	).toBe(401);

	// Bob is untouched.
	expect(existsSync(join(blobDir, bobFile))).toBe(true);
	expect((await store(bobId).stat("d1")).count).toBe(1);
	expect(
		(await call(base, `/api/files/${bobFile}`, bob.cookie, { method: "GET" }))
			.status,
	).toBe(200);
});

test("a fresh sign-in session also counts as proof", async () => {
	const { base } = await boot();
	const me = await signUp(base); // just signed in: the session is seconds old
	const res = await call(base, "/api/account", me.cookie, {
		method: "DELETE",
		body: "{}",
	});
	expect(res.status).toBe(200);
});
