import { afterEach, expect, test } from "bun:test";
import {
	createCipher,
	INDEX_DOC_ID,
	newWorkspaceKey,
	noteDocId,
	SyncClient,
} from "@seijaku/sync";
import * as Y from "yjs";
import { blobIdFor } from "./blobs";
import { openStore, startServer } from "./bun";

const cipher = createCipher(newWorkspaceKey());
const stops: (() => void)[] = [];
afterEach(() => {
	for (const stop of stops.splice(0)) stop();
});

async function until(check: () => boolean, ms = 3000) {
	const end = Date.now() + ms;
	while (!check()) {
		if (Date.now() > end) throw new Error("timed out");
		await new Promise((r) => setTimeout(r, 10));
	}
}

function connect(port: number) {
	const client = new SyncClient({
		url: () => `ws://localhost:${port}/sync`,
		cipher: () => cipher,
		minDelay: 20,
		maxDelay: 100,
	});
	client.start();
	stops.push(() => client.stop());
	return client;
}

test("two devices sync through a real Bun server and the data survives a restart", async () => {
	const dir = `${process.env.TEMP ?? "/tmp"}/seijaku-test-${Date.now()}`;
	const dbPath = `${dir}/db.sqlite`;

	const first = startServer({ port: 0, store: openStore(dbPath) });
	const a = connect(first.server.port ?? 0);
	const b = connect(first.server.port ?? 0);
	const docA = new Y.Doc();
	const docB = new Y.Doc();
	const attA = a.attach(noteDocId("abc"), docA);
	const attB = b.attach(noteDocId("abc"), docB);
	await attA.whenSynced();
	await attB.whenSynced();

	docA.getText("t").insert(0, "over a real socket");
	await until(() => docB.getText("t").toString() === "over a real socket");
	await until(() => a.getState().status === "synced");
	await first.flush();

	a.stop();
	b.stop();
	await first.server.stop(true);

	const second = startServer({ port: 0, store: openStore(dbPath) });
	const c = connect(second.server.port ?? 0);
	const docC = new Y.Doc();
	const attC = c.attach(noteDocId("abc"), docC);
	expect(await attC.whenSynced()).toBe(true);
	expect(docC.getText("t").toString()).toBe("over a real socket");
	await second.server.stop(true);
});

test("the client reconnects when the server comes back", async () => {
	const store = openStore(":memory:");
	const first = startServer({ port: 0, store });
	const port = first.server.port ?? 0;
	const client = connect(port);
	const doc = new Y.Doc();
	client.attach(INDEX_DOC_ID, doc);
	await until(() => client.getState().status === "synced");

	await first.server.stop(true);
	await until(() => client.getState().status === "offline");
	doc.getText("t").insert(0, "typed while down");

	const second = startServer({ port, store });
	await until(() => client.getState().status === "synced", 5000);
	await second.flush();
	const stored = new Y.Doc();
	for (const e of await store("").loadAfter(cipher.remoteId(INDEX_DOC_ID), 0))
		Y.applyUpdate(stored, cipher.open(INDEX_DOC_ID, e.data));
	expect(stored.getText("t").toString()).toBe("typed while down");
	await second.server.stop(true);
});

test("health route answers over HTTP", async () => {
	const { server } = startServer({ port: 0, store: openStore(":memory:") });
	const res = await fetch(`http://localhost:${server.port}/api/health`);
	expect(await res.json()).toEqual({ ok: true });
	await server.stop(true);
});

test("files upload, download with safe headers, and reject bad ids", async () => {
	const dir = `${process.env.TEMP ?? "/tmp"}/seijaku-blobs-${Date.now()}`;
	const { server } = startServer({
		port: 0,
		store: openStore(":memory:"),
		blobDir: dir,
	});
	const base = `http://localhost:${server.port}`;
	const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

	const up = await fetch(`${base}/api/files`, {
		method: "POST",
		headers: { "Content-Type": "image/png" },
		body: png,
	});
	const meta = (await up.json()) as { id: string; url: string; size: number };
	expect(up.status).toBe(200);
	expect(meta.size).toBe(8);

	const down = await fetch(base + meta.url);
	expect(down.headers.get("content-type")).toBe("image/png");
	expect(down.headers.get("x-content-type-options")).toBe("nosniff");
	expect(new Uint8Array(await down.arrayBuffer())).toEqual(png);

	// Active content is never served as itself.
	const html = await fetch(`${base}/api/files`, {
		method: "POST",
		headers: { "Content-Type": "text/html" },
		body: "<script>alert(1)</script>",
	});
	const h = (await html.json()) as { url: string };
	const served = await fetch(base + h.url);
	expect(served.headers.get("content-type")).toBe("application/octet-stream");
	expect(served.headers.get("content-disposition")).toBe("attachment");

	expect((await fetch(`${base}/api/files/nothex`)).status).toBe(404);
	expect(
		(await fetch(`${base}/api/files`, { method: "POST", body: "" })).status,
	).toBe(400);
	await server.stop(true);
});

test("two accounts on one server never see each other's log", () => {
	const store = openStore(":memory:");
	store("alice").append("doc", new Uint8Array([1, 2, 3]));
	expect(store("alice").loadAfter("doc", 0)).toHaveLength(1);
	expect(store("bob").loadAfter("doc", 0)).toHaveLength(0);
	expect(store("bob").stat("doc")).toEqual({ head: 0, count: 0 });
});

test("the web build is served, with app routes falling back to index.html", async () => {
	const web = `${process.env.TEMP ?? "/tmp"}/seijaku-web-${Date.now()}`;
	await Bun.write(`${web}/index.html`, "<html>app</html>");
	await Bun.write(`${web}/assets/a-1.js`, "console.log(1)");
	const { server } = startServer({
		port: 0,
		store: openStore(":memory:"),
		webDir: web,
	});
	const get = (p: string) => fetch(`http://localhost:${server.port}${p}`);
	expect(await (await get("/page/Hello-abc")).text()).toBe("<html>app</html>");
	expect(await (await get("/assets/a-1.js")).text()).toBe("console.log(1)");
	expect((await get("/assets/missing.js")).status).toBe(404);
	expect((await get("/api/nope")).status).toBe(404);
	// Climbing out of the folder never serves a file.
	expect((await get("/..%2f..%2fpackage.json")).status).toBe(404);
	await server.stop(true);
});

test("a file is stored under its own address, and a wrong address is refused", async () => {
	const dir = `${process.env.TEMP ?? "/tmp"}/seijaku-put-${Date.now()}`;
	const { server } = startServer({
		port: 0,
		store: openStore(":memory:"),
		blobDir: dir,
	});
	const base = `http://localhost:${server.port}`;
	const bytes = new Uint8Array([9, 8, 7, 6]);
	const id = await blobIdFor(bytes.buffer as ArrayBuffer);
	const put = (path: string) =>
		fetch(`${base}/api/files/${path}`, {
			method: "PUT",
			headers: { "Content-Type": "application/octet-stream" },
			body: bytes,
		});
	expect((await put(id)).status).toBe(200);
	expect((await put(id)).status).toBe(200); // a retried upload is harmless
	expect((await put("a".repeat(24))).status).toBe(400);
	expect((await put("short")).status).toBe(400);
	const back = await fetch(`${base}/api/files/${id}`);
	expect(new Uint8Array(await back.arrayBuffer())).toEqual(bytes);
	await server.stop(true);
});
