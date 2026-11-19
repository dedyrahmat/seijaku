/**
 * Black-box check of a running sync server (Bun or Cloudflare):
 *   bun scripts/smoke.ts ws://localhost:8791/sync [idleSeconds]
 * The server needs a session. By default this makes a throwaway account (set SEIJAKU_SIGNUP_CODE
 * when the server asks for a sign-up code); or pass a signed-in cookie as SEIJAKU_COOKIE
 * (e.g. "seijaku.session_token=...").
 * Two devices edit one note, then a third joins fresh and must see both edits.
 * With idleSeconds, the devices sit idle first (long enough for a Cloudflare Durable Object
 * to hibernate) and must still relay edits afterwards.
 */
import {
	createCipher,
	newPhrase,
	newWorkspaceKey,
	noteDocId,
	phraseKeys,
	SyncClient,
	toBase64,
	wrapWorkspaceKey,
} from "@seijaku/sync";
import * as Y from "yjs";

const url = process.argv[2] ?? "ws://localhost:8791/sync";
const idle = Number(process.argv[3] ?? 0);
const docId = noteDocId(`smoke-${Date.now()}`);

// Any key will do: the server only stores sealed blobs, and these devices share this one.
const cipher = createCipher(newWorkspaceKey());
const cookie = process.env.SEIJAKU_COOKIE ?? (await signUp());

async function signUp(): Promise<string> {
	const origin = new URL(url.replace(/^ws/, "http")).origin;
	const keys = phraseKeys(newPhrase());
	const res = await fetch(`${origin}/api/auth/seijaku/sign-up`, {
		method: "POST",
		headers: { Origin: origin, "Content-Type": "application/json" },
		body: JSON.stringify({
			token: process.env.SEIJAKU_SIGNUP_CODE,
			loginKey: keys.loginKey,
			wrapped: toBase64(wrapWorkspaceKey(keys.wrapKey, newWorkspaceKey())),
		}),
	});
	if (!res.ok) throw new Error(`sign-up failed: ${res.status}`);
	return res.headers
		.getSetCookie()
		.map((c) => c.split(";")[0])
		.join("; ");
}

function device() {
	const client = new SyncClient({
		url: () => url,
		cipher: () => cipher,
		createSocket: (u) =>
			new WebSocket(u, { headers: { Cookie: cookie } } as never) as never,
		minDelay: 100,
	});
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
