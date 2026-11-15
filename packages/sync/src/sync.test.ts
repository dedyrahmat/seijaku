import { describe, expect, test } from "bun:test";
import * as Y from "yjs";
import { type SocketLike, SyncClient } from "./client";
import { encodeResync, INDEX_DOC_ID, noteDocId } from "./protocol";
import { Room } from "./room";
import { MemoryUpdateStore, type UpdateStore } from "./store";

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

function device(room: Room, minDelay = 5) {
	const link = new Link(room);
	const client = new SyncClient({
		url: () => "ws://test",
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
		const slow: UpdateStore = {
			load: () => [],
			append: async (_id, u) => {
				await tick(30);
				stored.push(u);
			},
			replaceAll: () => {},
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

	test("compaction keeps the state and shrinks the log", async () => {
		const store = new MemoryUpdateStore();
		const room = new Room(store, { compactAfter: 10 });
		const a = device(room);
		const doc = new Y.Doc();
		const att = a.client.attach(noteDocId("k"), doc);
		await att.whenSynced();
		for (let i = 0; i < 50; i++) doc.getText("t").insert(0, "x");
		await until(() => a.client.getState().status === "synced");
		await room.flush();
		expect(store.logs.get(noteDocId("k"))?.length).toBeLessThanOrEqual(11);

		const restored = new Y.Doc();
		for (const u of store.load(noteDocId("k"))) Y.applyUpdate(restored, u);
		expect(text(restored)).toBe("x".repeat(50));
	});

	test("replaying the log on load does not grow it", async () => {
		const store = new MemoryUpdateStore();
		const seed = new Y.Doc();
		seed.getText("t").insert(0, "seed");
		store.append(noteDocId("r"), Y.encodeStateAsUpdate(seed));
		const room = new Room(store);
		await room.readDoc(noteDocId("r"));
		await room.flush();
		expect(store.logs.get(noteDocId("r"))?.length).toBe(1);
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
