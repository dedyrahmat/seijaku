/**
 * Black-box check of a running sync server (Bun or Cloudflare):
 *   bun scripts/smoke.ts ws://localhost:8787/sync [idleSeconds]
 * Two devices edit one note, then a third joins fresh and must see both edits.
 * With idleSeconds, the devices sit idle first (long enough for a Cloudflare Durable Object
 * to hibernate) and must still relay edits afterwards.
 */
import { noteDocId, SyncClient } from "@seijaku/sync";
import * as Y from "yjs";

const url = process.argv[2] ?? "ws://localhost:8787/sync";
const idle = Number(process.argv[3] ?? 0);
const docId = noteDocId(`smoke-${Date.now()}`);

function device() {
	const client = new SyncClient({ url: () => url, minDelay: 100 });
	client.start();
	return { client, doc: new Y.Doc() };
}

async function until(check: () => boolean, what: string, ms = 8000) {
	const end = Date.now() + ms;
	while (!check()) {
		if (Date.now() > end) throw new Error(`timed out: ${what}`);
		await new Promise((r) => setTimeout(r, 20));
	}
}

const a = device();
const b = device();
const attA = a.client.attach(docId, a.doc);
const attB = b.client.attach(docId, b.doc);
if (!(await attA.whenSynced()) || !(await attB.whenSynced()))
	throw new Error("handshake failed");

a.doc.getText("t").insert(0, "from A. ");
await until(() => b.doc.getText("t").toString() === "from A. ", "A to B");
b.doc.getText("t").insert(8, "from B.");
await until(
	() => a.doc.getText("t").toString() === "from A. from B.",
	"B to A",
);
await until(
	() =>
		a.client.getState().status === "synced" &&
		b.client.getState().status === "synced",
	"both synced",
);

if (idle > 0) {
	console.log(`idle for ${idle}s...`);
	await new Promise((r) => setTimeout(r, idle * 1000));
	a.doc.getText("t").insert(0, "[after idle] ");
	await until(
		() => b.doc.getText("t").toString().startsWith("[after idle] "),
		"edit relayed after idle",
	);
}
const expected = a.doc.getText("t").toString();

const c = device();
const attC = c.client.attach(docId, c.doc);
if (!(await attC.whenSynced())) throw new Error("fresh device failed to sync");
if (c.doc.getText("t").toString() !== expected)
	throw new Error(`fresh device saw "${c.doc.getText("t")}"`);

console.log(`ok: ${url}`);
for (const d of [a, b, c]) d.client.stop();
