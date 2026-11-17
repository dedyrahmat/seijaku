import { describe, expect, test } from "bun:test";
import * as Y from "yjs";
import { type DocSyncState, type SocketLike, SyncClient } from "./client";
import { type Cipher, createCipher, newWorkspaceKey } from "./crypto";
import { encodeResync, INDEX_DOC_ID, noteDocId } from "./protocol";
import { Room } from "./room";
import { MemoryUpdateStore, type UpdateStore } from "./store";

/** Every test workspace shares one key, as a person's devices do. */
const cipher: Cipher = createCipher(newWorkspaceKey());

/** In-memory link between one SyncClient and a Room, with an off switch for the network. */
class Link {
	online = true;
	sockets: FakeSocket[] = [];
	constructor(private room: Room) {}

	createSocket = (): SocketLike => {
		const s = new FakeSocket(this.room, this);
		this.sockets.push(s);
		return s;
	};

	/** Cuts every open socket, like losing wifi. New connections fail until `restore`. */
	cut(): void {
		this.online = false;
		for (const s of this.sockets) s.kill();
	}

	restore(): void {
		this.online = true;
	}
}

class FakeSocket implements SocketLike {
	binaryType = "blob";
	readyState = 0;
	onopen: SocketLike["onopen"] = null;
	onmessage: SocketLike["onmessage"] = null;
	onclose: SocketLike["onclose"] = null;
	onerror: SocketLike["onerror"] = null;
	private peer;

	constructor(room: Room, link: Link) {
		this.peer = room.join({
			send: (data) =>
				queueMicrotask(() => {
					if (this.readyState !== 1) return;
					const copy = data.slice().buffer;
					this.onmessage?.({ data: copy });
				}),
		});
		queueMicrotask(() => {
			if (!link.online) return this.kill();
			this.readyState = 1;
			this.onopen?.({});
		});
	}

	send(data: Uint8Array | string): void {
		if (this.readyState !== 1 || typeof data === "string") return;
		const copy = data.slice();
		queueMicrotask(() => {
			if (this.readyState === 1) void this.peer.receive(copy);
		});
	}

	close(): void {
		this.kill();
	}

	kill(): void {
		if (this.readyState === 3) return;
		this.readyState = 3;
		this.peer.leave();
		queueMicrotask(() => this.onclose?.({}));
	}
}

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

async function until(check: () => boolean, ms = 2000): Promise<void> {
	const end = Date.now() + ms;
	while (!check()) {
		if (Date.now() > end) throw new Error("timed out waiting for condition");
		await tick(2);
	}
}

function device(room: Room, minDelay = 5, key: Cipher = cipher) {
	const link = new Link(room);
	const client = new SyncClient({
		url: () => "ws://test",
		cipher: () => key,
		createSocket: link.createSocket,
		minDelay,
		maxDelay: 20,
		random: () => 1,
	});
	client.start();
	return { link, client };
}

function text(doc: Y.Doc): string {
	return doc.getText("t").toString();
}

describe("room and client", () => {
	test("an edit on one device reaches another", async () => {
		const room = new Room(new MemoryUpdateStore());
		const a = device(room);
		const b = device(room);
		const docA = new Y.Doc();
		const docB = new Y.Doc();
		a.client.attach(INDEX_DOC_ID, docA);
		b.client.attach(INDEX_DOC_ID, docB);

		docA.getText("t").insert(0, "hello");
		await until(() => text(docB) === "hello");
		docB.getText("t").insert(5, " world");
		await until(() => text(docA) === "hello world");
	});

	test("a new device receives what the server already holds", async () => {
		const room = new Room(new MemoryUpdateStore());
		const a = device(room);
		const docA = new Y.Doc();
		docA.getText("t").insert(0, "from before");
		const att = a.client.attach(noteDocId("n1"), docA);
		expect(await att.whenSynced()).toBe(true);

		const b = device(room);
		const docB = new Y.Doc();
		const attB = b.client.attach(noteDocId("n1"), docB);
		expect(await attB.whenSynced()).toBe(true);
		expect(text(docB)).toBe("from before");
	});

	test("offline edits on both devices merge after reconnect", async () => {
		const room = new Room(new MemoryUpdateStore());
		const a = device(room);
		const b = device(room);
		const docA = new Y.Doc();
		const docB = new Y.Doc();
		const attA = a.client.attach(noteDocId("n"), docA);
		const attB = b.client.attach(noteDocId("n"), docB);
		await attA.whenSynced();
		await attB.whenSynced();
		docA.getText("t").insert(0, "base");
		await until(() => text(docB) === "base");

		a.link.cut();
		b.link.cut();
		await until(() => a.client.getState().status === "offline");
		docA.getText("t").insert(0, "A:");
		docB.getText("t").insert(4, ":B");
		expect(text(docA)).toBe("A:base");
		expect(text(docB)).toBe("base:B");

		a.link.restore();
		b.link.restore();
		await until(
			() => text(docA) === "A:base:B" && text(docB) === "A:base:B",
			3000,
		);
		await until(() => a.client.getState().status === "synced");
	});

	test("concurrent edits converge to the same text", async () => {
		const room = new Room(new MemoryUpdateStore());
		const a = device(room);
		const b = device(room);
		const docA = new Y.Doc();
		const docB = new Y.Doc();
		const attA = a.client.attach(noteDocId("c"), docA);
		const attB = b.client.attach(noteDocId("c"), docB);
		await attA.whenSynced();
		await attB.whenSynced();
		for (let i = 0; i < 20; i++) {
			docA.getText("t").insert(0, "a");
			docB.getText("t").insert(0, "b");
		}
		await until(
			() => text(docA).length === 40 && text(docA) === text(docB),
			3000,
		);
	});

	test("status goes offline, back to syncing, then synced", async () => {
		const room = new Room(new MemoryUpdateStore());
		const a = device(room);
		const doc = new Y.Doc();
		const seen: string[] = [];
		a.client.subscribe(() => seen.push(a.client.getState().status));
		a.client.attach(INDEX_DOC_ID, doc);
		await until(() => a.client.getState().status === "synced");
		a.link.cut();
		await until(() => a.client.getState().status === "offline");
		a.link.restore();
		await until(() => a.client.getState().status === "synced");
		expect(seen).toContain("syncing");
		expect(seen).toContain("offline");
		expect(a.client.getState().pending).toBe(0);
	});

	test("updates are acknowledged only after they are stored", async () => {
		const stored: Uint8Array[] = [];
		const inner = new MemoryUpdateStore();
		const slow: UpdateStore = {
			append: async (id, u) => {
				await tick(30);
				stored.push(u);
				return inner.append(id, u);
			},
			loadAfter: (id, after) => inner.loadAfter(id, after),
			stat: (id) => inner.stat(id),
			replaceUpTo: (id, upto, snap) => inner.replaceUpTo(id, upto, snap),
		};
		const room = new Room(slow);
		const a = device(room);
		const doc = new Y.Doc();
		const att = a.client.attach(INDEX_DOC_ID, doc);
		await att.whenSynced();
		doc.getText("t").insert(0, "x");
		expect(a.client.getState().pending).toBe(1);
		expect(a.client.getState().status).toBe("syncing");
		await until(() => a.client.getState().status === "synced");
		expect(stored.length).toBeGreaterThan(0);
	});

	test("a notice reaches devices that are not subscribed to a changed doc", async () => {
		const room = new Room(new MemoryUpdateStore());
		const a = device(room);
		const b = device(room);
		const heard: string[] = [];
		b.client.onNotify((id) => heard.push(id));
		b.client.learn(noteDocId("far"));
		const docA = new Y.Doc();
		const attA = a.client.attach(noteDocId("far"), docA);
		await attA.whenSynced();
		docA.getText("t").insert(0, "1");
		docA.getText("t").insert(1, "2");
		await until(() => heard.length > 0);
		await tick(20);
		expect(heard).toEqual([noteDocId("far")]); // one notice, not one per keystroke
	});

	test("after a detach the device stops receiving that doc's updates", async () => {
		const room = new Room(new MemoryUpdateStore());
		const a = device(room);
		const b = device(room);
		const docA = new Y.Doc();
		const docB = new Y.Doc();
		const attA = a.client.attach(noteDocId("d"), docA);
		const attB = b.client.attach(noteDocId("d"), docB, true);
		await attA.whenSynced();
		await attB.whenSynced();
		attB.detach();
		await tick(20);
		docA.getText("t").insert(0, "later");
		await tick(40);
		expect(text(docB)).toBe("");
	});

	test("the room unloads docs nobody is subscribed to", async () => {
		const room = new Room(new MemoryUpdateStore());
		const a = device(room);
		const att = a.client.attach(noteDocId("e"), new Y.Doc());
		await att.whenSynced();
		expect(room.loadedDocs).toBe(1);
		att.detach();
		await tick(30);
		expect(room.loadedDocs).toBe(0);
	});
});

describe("persistence", () => {
	test("a restarted room serves what an earlier one stored", async () => {
		const store = new MemoryUpdateStore();
		const room1 = new Room(store);
		const a = device(room1);
		const doc = new Y.Doc();
		const att = a.client.attach(noteDocId("p"), doc);
		await att.whenSynced();
		doc.getText("t").insert(0, "durable");
		await until(() => a.client.getState().status === "synced");
		a.client.stop();

		const room2 = new Room(store);
		const b = device(room2);
		const fresh = new Y.Doc();
		const attB = b.client.attach(noteDocId("p"), fresh);
		expect(await attB.whenSynced()).toBe(true);
		expect(text(fresh)).toBe("durable");
	});

	test("a long log is folded into one entry by a device that has read it all", async () => {
		const store = new MemoryUpdateStore();
		const room = new Room(store);
		const a = device(room);
		const doc = new Y.Doc();
		const att = a.client.attach(noteDocId("k"), doc);
		await att.whenSynced();
		for (let i = 0; i < 130; i++) doc.getText("t").insert(0, "x");
		await until(() => a.client.getState().status === "synced");
		const remote = cipher.remoteId(noteDocId("k"));
		expect(store.logs.get(remote)?.length).toBeGreaterThan(100);

		// The next time it connects it sees a long log and tidies it.
		a.link.cut();
		await until(() => a.client.getState().status === "offline");
		a.link.restore();
		await until(() => (store.logs.get(remote)?.length ?? 99) <= 2);

		const fresh = device(room);
		const copy = new Y.Doc();
		expect(await fresh.client.attach(noteDocId("k"), copy).whenSynced()).toBe(
			true,
		);
		expect(text(copy)).toBe("x".repeat(130));
	});

	test("a device that remembers its place neither downloads nor uploads again", async () => {
		const store = new MemoryUpdateStore();
		const room = new Room(store);
		const a = device(room);
		const doc = new Y.Doc();
		let saved: DocSyncState | null = null;
		const att = a.client.attach(noteDocId("m"), doc, {
			onState: (s) => {
				saved = s;
			},
		});
		await att.whenSynced();
		doc.getText("t").insert(0, "once");
		await until(() => a.client.getState().status === "synced");
		await tick(10);
		a.client.stop();
		const remote = cipher.remoteId(noteDocId("m"));
		const before = store.logs.get(remote)?.length;

		const b = device(room);
		const again = b.client.attach(noteDocId("m"), doc, { state: saved });
		expect(await again.whenSynced()).toBe(true);
		expect(store.logs.get(remote)?.length).toBe(before);
	});

	test("a server that lost its data gets everything again", async () => {
		const store = new MemoryUpdateStore();
		const room = new Room(store);
		const a = device(room);
		const doc = new Y.Doc();
		let saved: DocSyncState | null = null;
		const att = a.client.attach(noteDocId("z"), doc, {
			onState: (s) => {
				saved = s;
			},
		});
		await att.whenSynced();
		doc.getText("t").insert(0, "precious");
		await until(() => a.client.getState().status === "synced");
		await tick(10);
		a.client.stop();

		const empty = new MemoryUpdateStore();
		const b = device(new Room(empty));
		expect(
			await b.client.attach(noteDocId("z"), doc, { state: saved }).whenSynced(),
		).toBe(true);
		const remote = cipher.remoteId(noteDocId("z"));
		expect((empty.logs.get(remote) ?? []).length).toBeGreaterThan(0);
	});

	test("saved state from another account's key is ignored and the doc is uploaded in full", async () => {
		const a = device(new Room(new MemoryUpdateStore()));
		const doc = new Y.Doc();
		let saved: DocSyncState | null = null;
		const att = a.client.attach(noteDocId("w"), doc, {
			onState: (s) => {
				saved = s;
			},
		});
		await att.whenSynced();
		doc.getText("t").insert(0, "written signed out, then signed in elsewhere");
		await until(() => a.client.getState().status === "synced");
		await tick(10);
		a.client.stop();
		expect(saved).not.toBeNull();

		const other = createCipher(newWorkspaceKey());
		const store = new MemoryUpdateStore();
		const b = device(new Room(store), 5, other);
		let next: DocSyncState | null = null;
		expect(
			await b.client
				.attach(noteDocId("w"), doc, {
					state: saved,
					onState: (s) => {
						next = s;
					},
				})
				.whenSynced(),
		).toBe(true);
		const remote = other.remoteId(noteDocId("w"));
		expect((store.logs.get(remote) ?? []).length).toBeGreaterThan(0);
		await tick(10);
		expect((next as DocSyncState | null)?.remoteId).toBe(remote);
	});
});

describe("end-to-end encryption", () => {
	test("the server never holds readable text or readable names", async () => {
		const store = new MemoryUpdateStore();
		const room = new Room(store);
		const a = device(room);
		const doc = new Y.Doc();
		const att = a.client.attach(noteDocId("daily-2026-11-16"), doc);
		await att.whenSynced();
		doc.getText("t").insert(0, "my secret grocery list");
		await until(() => a.client.getState().status === "synced");

		const needle = new TextEncoder().encode("secret grocery");
		for (const [id, log] of store.logs) {
			expect(id).not.toContain("daily");
			expect(id).toMatch(/^d[a-f0-9]{32}$/);
			for (const e of log) {
				const hay = Buffer.from(e.data).toString("latin1");
				expect(hay).not.toContain(Buffer.from(needle).toString("latin1"));
			}
		}
	});

	test("a device with another key cannot read the notes", async () => {
		const store = new MemoryUpdateStore();
		const room = new Room(store);
		const a = device(room);
		const doc = new Y.Doc();
		await a.client.attach(noteDocId("s"), doc).whenSynced();
		doc.getText("t").insert(0, "private");
		await until(() => a.client.getState().status === "synced");

		const stranger = createCipher(newWorkspaceKey());
		const b = device(room, 5, stranger);
		const theirs = new Y.Doc();
		b.client.attach(noteDocId("s"), theirs);
		await tick(60);
		expect(text(theirs)).toBe("");
	});

	test("an altered entry is refused", async () => {
		const store = new MemoryUpdateStore();
		const room = new Room(store);
		const a = device(room);
		const doc = new Y.Doc();
		await a.client.attach(noteDocId("t"), doc).whenSynced();
		doc.getText("t").insert(0, "honest");
		await until(() => a.client.getState().status === "synced");
		for (const log of store.logs.values())
			for (const e of log) e.data[e.data.length - 1] = (e.data.at(-1) ?? 0) ^ 1;

		const b = device(room);
		const copy = new Y.Doc();
		b.client.attach(noteDocId("t"), copy);
		await tick(60);
		expect(text(copy)).toBe("");
	});
});

describe("hardening", () => {
	test("frames with bad doc ids or garbage are ignored", async () => {
		const store = new MemoryUpdateStore();
		const room = new Room(store);
		const sent: Uint8Array[] = [];
		const peer = room.join({ send: (d) => sent.push(d) });
		await peer.receive(new Uint8Array([1, 2, 3]));
		await peer.receive(new Uint8Array(0));
		expect(sent.length).toBe(0);
		expect(room.loadedDocs).toBe(0);
	});

	test("an oversized frame closes the connection", async () => {
		const room = new Room(new MemoryUpdateStore());
		const closed: { code: number | null } = { code: null };
		const peer = room.join({
			send: () => {},
			close: (code) => {
				closed.code = code;
			},
		});
		await peer.receive(new Uint8Array(9 * 1024 * 1024));
		expect(closed.code).toBe(1009);
	});
});

describe("resync", () => {
	test("a Resync frame makes the client subscribe to its docs again", async () => {
		const room = new Room(new MemoryUpdateStore());
		const a = device(room);
		const doc = new Y.Doc();
		const att = a.client.attach(noteDocId("w"), doc);
		await att.whenSynced();
		const sent: Uint8Array[] = [];
		const socket = a.link.sockets.at(-1) as FakeSocket;
		const realSend = socket.send.bind(socket);
		socket.send = (data) => {
			if (typeof data !== "string") sent.push(data);
			realSend(data);
		};
		socket.onmessage?.({ data: encodeResync().slice().buffer });
		expect(sent.length).toBe(1);
		expect(await att.whenSynced()).toBe(true);
	});
});
