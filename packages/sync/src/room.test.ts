import { expect, test } from "bun:test";
import { encodeDrop, encodePush, encodeSnapshot } from "./protocol";
import { Room } from "./room";
import { MemoryUpdateStore } from "./store";

const DOC = `d${"a".repeat(32)}`;

function join(room: Room, access = {}) {
	const closed: number[] = [];
	const peer = room.join(
		{ send: () => undefined, close: (code) => closed.push(code) },
		access,
	);
	return { peer, closed };
}

test("a push that would pass the storage limit closes the connection and is not stored", async () => {
	const store = new MemoryUpdateStore();
	const room = new Room(store, 10);
	const { peer, closed } = join(room);
	await peer.receive(encodePush(DOC, new Uint8Array(6)));
	await peer.receive(encodePush(DOC, new Uint8Array(6)));
	expect(store.stat(DOC).count).toBe(1);
	expect(closed).toEqual([4008]);
});

test("the limit counts again after a doc is dropped", async () => {
	const store = new MemoryUpdateStore();
	const room = new Room(store, 10);
	const { peer, closed } = join(room);
	await peer.receive(encodePush(DOC, new Uint8Array(8)));
	await peer.receive(encodeDrop(DOC));
	await peer.receive(encodePush(DOC, new Uint8Array(8)));
	expect(store.stat(DOC).count).toBe(1);
	expect(closed).toEqual([]);
});

test("only an admin may drop a doc or replace its log with a snapshot", async () => {
	const store = new MemoryUpdateStore();
	const room = new Room(store);
	const editor = join(room, { canWrite: () => true, canAdmin: () => false });
	await editor.peer.receive(encodePush(DOC, new Uint8Array(3)));
	await editor.peer.receive(encodeSnapshot(DOC, 1, new Uint8Array(1)));
	await editor.peer.receive(encodeDrop(DOC));
	expect(store.logs.get(DOC)?.[0]?.data.length).toBe(3);

	const owner = join(room, { canWrite: () => true, canAdmin: () => true });
	await owner.peer.receive(encodeDrop(DOC));
	expect(store.stat(DOC).count).toBe(0);
});
