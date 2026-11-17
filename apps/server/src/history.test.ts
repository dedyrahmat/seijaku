import { afterEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
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
import { versionsToKeep } from "./history";

const stops: (() => void)[] = [];
afterEach(() => {
	for (const stop of stops.splice(0)) stop();
});

async function boot() {
	const dir = mkdtempSync(join(tmpdir(), "seijaku-history-"));
	const dbPath = join(dir, "db.sqlite");
	const auth = await openAuth(dbPath, {}, 0);
	const { server } = startServer({
		port: 0,
		store: openStore(dbPath),
		blobDir: join(dir, "blobs"),
		auth,
	});
	stops.push(() => server.stop(true));
	return `http://localhost:${server.port}`;
}

const json = {
	Origin: "http://localhost:5173",
	"Content-Type": "application/json",
};

/** A new account; returns its session cookie. */
async function signUp(base: string): Promise<string> {
	const keys = phraseKeys(newPhrase());
	const res = await fetch(`${base}/api/auth/seijaku/sign-up`, {
		method: "POST",
		headers: json,
		body: JSON.stringify({
			loginKey: keys.loginKey,
			wrapped: toBase64(wrapWorkspaceKey(keys.wrapKey, newWorkspaceKey())),
		}),
	});
	return res.headers
		.getSetCookie()
		.map((c) => c.split(";")[0])
		.join("; ");
}

const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));
const urlSafe = (bytes: number[]) =>
	b64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const doc = `d${"a".repeat(32)}`;

function call(
	base: string,
	path: string,
	cookie: string,
	init: RequestInit = {},
) {
	return fetch(`${base}${path}`, {
		...init,
		headers: { ...json, ...(cookie ? { Cookie: cookie } : {}) },
	});
}

test("snapshots are listed newest first, belong to their owner, and need a session", async () => {
	const base = await boot();
	const alice = await signUp(base);
	const bob = await signUp(base);

	expect((await call(base, "/api/versions?doc=" + doc, "")).status).toBe(401);
	const made = await call(base, "/api/versions", alice, {
		method: "POST",
		body: JSON.stringify({ doc, meta: "sealed-meta", data: b64([1, 2, 3]) }),
	});
	expect(made.status).toBe(200);
	const { id } = (await made.json()) as { id: string };

	const list = (await (
		await call(base, `/api/versions?doc=${doc}`, alice)
	).json()) as {
		id: string;
		meta: string;
	}[];
	expect(list.map((v) => v.id)).toEqual([id]);
	expect(list[0]?.meta).toBe("sealed-meta");

	const bytes = await call(base, `/api/versions/${id}`, alice);
	expect(new Uint8Array(await bytes.arrayBuffer())).toEqual(
		new Uint8Array([1, 2, 3]),
	);

	// Another account sees nothing and cannot fetch it.
	expect(
		await (await call(base, `/api/versions?doc=${doc}`, bob)).json(),
	).toEqual([]);
	expect((await call(base, `/api/versions/${id}`, bob)).status).toBe(404);
	expect(
		(
			await call(base, "/api/versions", alice, {
				method: "POST",
				body: JSON.stringify({ doc: "note-1", meta: "m", data: "AA==" }),
			})
		).status,
	).toBe(400);
});

test("a share is public by token, replaceable, and revocable only by its owner", async () => {
	const base = await boot();
	const alice = await signUp(base);
	const bob = await signUp(base);

	const made = await call(base, "/api/shares", alice, {
		method: "PUT",
		body: JSON.stringify({ data: b64([7, 7]) }),
	});
	const { token } = (await made.json()) as { token: string };
	expect(token).toMatch(/^[A-Za-z0-9_-]{16}$/);

	// No session needed to read.
	const read = await fetch(`${base}/api/shares/${token}`);
	expect(read.status).toBe(200);
	expect(read.headers.get("x-robots-tag")).toBe("noindex");
	expect(new Uint8Array(await read.arrayBuffer())).toEqual(
		new Uint8Array([7, 7]),
	);

	// Republishing keeps the link and swaps the content; a stranger cannot take it over.
	const again = await call(base, "/api/shares", alice, {
		method: "PUT",
		body: JSON.stringify({ token, data: b64([8]) }),
	});
	expect(((await again.json()) as { token: string }).token).toBe(token);
	expect(
		new Uint8Array(
			await (await fetch(`${base}/api/shares/${token}`)).arrayBuffer(),
		),
	).toEqual(new Uint8Array([8]));
	const hijack = await call(base, "/api/shares", bob, {
		method: "PUT",
		body: JSON.stringify({ token, data: b64([9]) }),
	});
	expect(((await hijack.json()) as { token: string }).token).not.toBe(token);

	await call(base, `/api/shares/${token}`, bob, { method: "DELETE" });
	expect((await fetch(`${base}/api/shares/${token}`)).status).toBe(200);
	await call(base, `/api/shares/${token}`, alice, { method: "DELETE" });
	expect((await fetch(`${base}/api/shares/${token}`)).status).toBe(404);
	expect((await fetch(`${base}/api/shares/not-a-token`)).status).toBe(404);
});

test("shares accept URL-safe base64 as the app sends it", async () => {
	const base = await boot();
	const alice = await signUp(base);
	// 0xfb 0xff encodes with characters that differ between the two alphabets.
	const made = await call(base, "/api/shares", alice, {
		method: "PUT",
		body: JSON.stringify({ data: urlSafe([0xfb, 0xff, 0xfe]) }),
	});
	const { token } = (await made.json()) as { token: string };
	const read = await fetch(`${base}/api/shares/${token}`);
	expect(new Uint8Array(await read.arrayBuffer())).toEqual(
		new Uint8Array([0xfb, 0xff, 0xfe]),
	);
});

test("thinning keeps recent snapshots dense and old ones sparse", () => {
	const now = Date.UTC(2026, 10, 17, 12, 0, 0);
	const min = 60_000;
	const day = 86_400_000;
	const v = (id: string, at: number) => ({ id, at });
	const kept = versionsToKeep(
		[
			v("a", now - 1 * min),
			v("b", now - 3 * min), // the last hour is kept in full
			v("c", now - 85 * min),
			v("c2", now - 88 * min), // same ten minutes as c
			v("d", now - 2 * day),
			v("e", now - 2 * day - 60 * min), // same day as d
			v("f", now - 60 * day),
			v("g", now - 61 * day), // same week as f (or neighbour)
		],
		now,
	);
	expect(kept.has("a")).toBe(true);
	expect(kept.has("b")).toBe(true);
	expect(kept.has("c")).toBe(true);
	expect(kept.has("c2")).toBe(false);
	expect(kept.has("d")).toBe(true);
	expect(kept.has("e")).toBe(false);
	expect(kept.has("f")).toBe(true);
	// "Keep version history: 30 days" drops the old ones outright.
	const short = versionsToKeep([v("a", now), v("f", now - 60 * day)], now, 30);
	expect([...short]).toEqual(["a"]);
});
