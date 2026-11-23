import { afterEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	decodeFrame,
	encodePush,
	encodeSubscribe,
	FrameKind,
	newKeyPair,
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
	const dir = mkdtempSync(join(tmpdir(), "seijaku-shared-"));
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

const api = (
	base: string,
	cookie: string,
	method: string,
	path: string,
	body?: unknown,
) =>
	fetch(`${base}${path}`, {
		method,
		headers: { ...json, Cookie: cookie },
		body: body === undefined ? undefined : JSON.stringify(body),
	});

const pk = () => toBase64(newKeyPair().publicKey);
const sealed = toBase64(new Uint8Array([1, 2, 3]));
const doc = `d${"b".repeat(32)}`;

/** A socket into a shared page's room that records what the server sends. */
async function connect(base: string, cookie: string, shareId: string) {
	const ws = new WebSocket(
		`${base.replace("http", "ws")}/sync/shared/${shareId}`,
		{ headers: { Cookie: cookie, Origin: "http://localhost:5173" } } as never,
	);
	ws.binaryType = "arraybuffer";
	const kinds: number[] = [];
	const closed = new Promise<number>((res) => {
		ws.onclose = (e) => res(e.code);
	});
	ws.onmessage = (e) => {
		if (typeof e.data === "string") return;
		const f = decodeFrame(new Uint8Array(e.data as ArrayBuffer));
		if (f) kinds.push(f.kind);
	};
	await new Promise<void>((res, rej) => {
		ws.onopen = () => res();
		ws.onerror = () => rej(new Error("socket refused"));
	});
	return { ws, kinds, closed };
}
const settle = () => new Promise((r) => setTimeout(r, 150));

/** Owner makes a page and invites one member; returns the ids. */
async function shareWith(
	base: string,
	owner: string,
	member: string,
	role: "editor" | "reader",
) {
	const { id } = (await (
		await api(base, owner, "POST", "/api/shared")
	).json()) as {
		id: string;
	};
	const inv = (await (
		await api(base, owner, "POST", `/api/shared/${id}/invites`, {
			role,
			label: "for Dina",
			wrapped: sealed,
		})
	).json()) as { id: string };
	const opened = await api(base, member, "GET", `/api/invites/${inv.id}`);
	expect(((await opened.json()) as { wrapped: string }).wrapped).toBe(sealed);
	const claimed = await api(
		base,
		member,
		"POST",
		`/api/invites/${inv.id}/claim`,
		{
			publicKey: pk(),
		},
	);
	expect(claimed.status).toBe(200);
	return { id, invite: inv.id };
}

test("an invite works once, for a signed-in account, and shows in both people's lists", async () => {
	const base = await boot();
	const alice = await signUp(base);
	const dina = await signUp(base);
	const eve = await signUp(base);
	const { id, invite } = await shareWith(base, alice, dina, "editor");

	const again = await api(base, eve, "POST", `/api/invites/${invite}/claim`, {
		publicKey: pk(),
	});
	expect(again.status).toBe(404); // used up
	expect((await fetch(`${base}/api/invites/${invite}`)).status).toBe(401);

	const mine = (await (await api(base, dina, "GET", "/api/shared")).json()) as {
		id: string;
		role: string;
	}[];
	expect(mine).toMatchObject([{ id, role: "editor" }]);
	const members = (await (
		await api(base, alice, "GET", `/api/shared/${id}/members`)
	).json()) as { role: string; label: string; publicKey: string | null }[];
	expect(members.map((m) => m.role).sort()).toEqual(["editor", "owner"]);
	expect(members.find((m) => m.role === "editor")?.publicKey).toBeTruthy();
	// Only the owner sees the people list or makes invites.
	expect(
		(await api(base, dina, "GET", `/api/shared/${id}/members`)).status,
	).toBe(404);
	expect(
		(
			await api(base, dina, "POST", `/api/shared/${id}/invites`, {
				role: "reader",
				wrapped: sealed,
			})
		).status,
	).toBe(404);
});

test("a reader can read what an editor wrote but cannot write, and strangers are refused", async () => {
	const base = await boot();
	const alice = await signUp(base);
	const dina = await signUp(base);
	const rob = await signUp(base);
	const eve = await signUp(base);
	const { id } = await shareWith(base, alice, dina, "editor");
	const inv = (await (
		await api(base, alice, "POST", `/api/shared/${id}/invites`, {
			role: "reader",
			wrapped: sealed,
		})
	).json()) as { id: string };
	await api(base, rob, "POST", `/api/invites/${inv.id}/claim`, {
		publicKey: pk(),
	});

	await expect(connect(base, eve, id)).rejects.toThrow(); // not a member

	const editor = await connect(base, dina, id);
	editor.ws.send(encodePush(doc, new Uint8Array([9, 9])) as never);
	await settle();
	expect(editor.kinds).toContain(FrameKind.Ack);

	const reader = await connect(base, rob, id);
	reader.ws.send(encodeSubscribe(doc, 0) as never);
	await settle();
	expect(reader.kinds).toContain(FrameKind.Entry); // sees the editor's update
	reader.kinds.length = 0;
	reader.ws.send(encodePush(doc, new Uint8Array([7])) as never);
	await settle();
	expect(reader.kinds).not.toContain(FrameKind.Ack); // refused, not stored

	const check = await connect(base, alice, id);
	check.ws.send(encodeSubscribe(doc, 0) as never);
	await settle();
	expect(check.kinds.filter((k) => k === FrameKind.Entry)).toHaveLength(1);
	for (const s of [editor, reader, check]) s.ws.close();
});

test("removing a member hangs up on them and shuts the door; rotation needs a key for everyone and empties the room", async () => {
	const base = await boot();
	const alice = await signUp(base);
	const dina = await signUp(base);
	const { id } = await shareWith(base, alice, dina, "editor");
	const members = (await (
		await api(base, alice, "GET", `/api/shared/${id}/members`)
	).json()) as { memberId: string; role: string }[];
	const dinaRow = members.find((m) => m.role === "editor")?.memberId as string;

	const owner = await connect(base, alice, id);
	owner.ws.send(encodePush(doc, new Uint8Array([1])) as never);
	await settle();
	const live = await connect(base, dina, id);

	// Rotation without a key for Dina is refused.
	expect(
		(await api(base, alice, "POST", `/api/shared/${id}/rotate`, { wraps: [] }))
			.status,
	).toBe(400);
	const rotated = await api(base, alice, "POST", `/api/shared/${id}/rotate`, {
		wraps: [{ memberId: dinaRow, wrapped: sealed }],
	});
	expect(((await rotated.json()) as { epoch: number }).epoch).toBe(1);
	expect(await live.closed).toBe(4002); // everyone reconnects under the new key
	const mine = (await (await api(base, dina, "GET", "/api/shared")).json()) as {
		epoch: number;
		wrappedKey: string;
	}[];
	expect(mine[0]).toMatchObject({ epoch: 1, wrappedKey: sealed });

	const fresh = await connect(base, alice, id);
	fresh.ws.send(encodeSubscribe(doc, 0) as never);
	await settle();
	expect(fresh.kinds).not.toContain(FrameKind.Entry); // the old log is gone

	const again = await connect(base, dina, id);
	expect(
		(await api(base, alice, "DELETE", `/api/shared/${id}/members/${dinaRow}`))
			.status,
	).toBe(200);
	expect(await again.closed).toBe(4003);
	await expect(connect(base, dina, id)).rejects.toThrow();
	expect(
		(await (await api(base, dina, "GET", "/api/shared")).json()) as [],
	).toEqual([]);
	fresh.ws.close();
});

test("a member can leave, and stopping sharing removes the page for everyone", async () => {
	const base = await boot();
	const alice = await signUp(base);
	const dina = await signUp(base);
	const { id } = await shareWith(base, alice, dina, "reader");
	const mine = (await (await api(base, dina, "GET", "/api/shared")).json()) as {
		memberId: string;
	}[];
	expect(
		(
			await api(
				base,
				dina,
				"DELETE",
				`/api/shared/${id}/members/${mine[0]?.memberId}`,
			)
		).status,
	).toBe(200);
	expect(
		((await (await api(base, dina, "GET", "/api/shared")).json()) as []).length,
	).toBe(0);

	expect((await api(base, dina, "DELETE", `/api/shared/${id}`)).status).toBe(
		404,
	); // not the owner
	expect((await api(base, alice, "DELETE", `/api/shared/${id}`)).status).toBe(
		200,
	);
	expect(
		(
			(await (await api(base, alice, "GET", "/api/shared")).json()) as {
				id: string;
			}[]
		).some((p) => p.id === id),
	).toBe(false);
});
