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

	expect((await call(base, `/api/versions?doc=${doc}`, "")).status).toBe(401);
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

test("a share can expire, answers 410 until renewed, and reports when it was updated", async () => {
	const base = await boot();
	const alice = await signUp(base);
	const put = (body: object) =>
		call(base, "/api/shares", alice, {
			method: "PUT",
			body: JSON.stringify({ data: b64([1, 2, 3]), ...body }),
		});
	const { token } = (await (
		await put({ expiresAt: Date.now() + 60_000 })
	).json()) as { token: string };
	const open = await call(base, `/api/shares/${token}`, "");
	expect(open.status).toBe(200);
	expect(Number(open.headers.get("x-updated-at"))).toBeGreaterThan(0);

	await put({ token, expiresAt: Date.now() - 1000 });
	expect((await call(base, `/api/shares/${token}`, "")).status).toBe(410);

	await put({ token }); // no date given: the old one stays
	expect((await call(base, `/api/shares/${token}`, "")).status).toBe(410);
	await put({ token, expiresAt: null }); // renewed for good
	expect((await call(base, `/api/shares/${token}`, "")).status).toBe(200);
});

test("limits refuse a new share or file, and drop the oldest snapshots", async () => {
	process.env.QUOTA_SHARES = "1";
	process.env.QUOTA_FILES_MB = "1";
	process.env.QUOTA_SNAPSHOTS = "2";
	try {
		const base = await boot();
		const alice = await signUp(base);
		const share = (token?: string) =>
			call(base, "/api/shares", alice, {
				method: "PUT",
				body: JSON.stringify({ token, data: b64([1]) }),
			});
		const first = (await (await share()).json()) as { token: string };
		const refused = await share();
		expect(refused.status).toBe(413);
		expect(((await refused.json()) as { what: string }).what).toBe("shares");
		expect((await share(first.token)).status).toBe(200); // replacing is fine

		const upload = (n: number) =>
			fetch(`${base}/api/files`, {
				method: "POST",
				headers: { Cookie: alice, "Content-Type": "image/png" },
				body: new Uint8Array(n),
			});
		expect((await upload(700 * 1024)).status).toBe(200);
		expect((await upload(700 * 1024)).status).toBe(413);

		for (let i = 0; i < 4; i++)
			await call(base, "/api/versions", alice, {
				method: "POST",
				body: JSON.stringify({ doc, meta: "m", data: b64([i + 1]) }),
			});
		const usage = (await (await call(base, "/api/usage", alice)).json()) as {
			files: { used: number };
			snapshots: { used: number; limit: number };
			shares: { used: number };
		};
		expect(usage.snapshots).toEqual({ used: 2, limit: 2 });
		expect(usage.shares.used).toBe(1);
		// Snapshots and published pages count against the same storage limit: 1 byte + 2 x 1 byte.
		expect(usage.files.used).toBe(700 * 1024 + 3);
	} finally {
		delete process.env.QUOTA_SHARES;
		delete process.env.QUOTA_FILES_MB;
		delete process.env.QUOTA_SNAPSHOTS;
	}
});

test("a snapshot or published page that does not fit the storage limit is refused", async () => {
	process.env.QUOTA_FILES_MB = "1";
	try {
		const base = await boot();
		const alice = await signUp(base);
		const big = Buffer.alloc(700 * 1024, 7).toString("base64");
		const send = (path: string, body: object, method = "POST") =>
			call(base, path, alice, { method, body: JSON.stringify(body) });
		expect(
			(await send("/api/versions", { doc, meta: "m", data: big })).status,
		).toBe(200);
		expect(
			(await send("/api/versions", { doc, meta: "m", data: big })).status,
		).toBe(413);
		expect((await send("/api/shares", { data: big }, "PUT")).status).toBe(413);
	} finally {
		delete process.env.QUOTA_FILES_MB;
	}
});
