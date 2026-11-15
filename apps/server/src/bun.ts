import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
	MAX_FRAME_BYTES,
	type Peer,
	PING,
	PONG,
	Room,
	type UpdateStore,
} from "@seijaku/sync";
import { createApp } from "./app";
import { DiskBlobStore } from "./disk-blobs";
import { type SqlDriver, SqlUpdateStore } from "./sql-store";

/** Self-host entry point: Hono over `Bun.serve`, one in-process room, bun:sqlite on disk. */

function bunDriver(db: Database): SqlDriver {
	return {
		exec: (sql) => db.exec(sql),
		all: <T>(sql: string, params: unknown[] = []) =>
			db.query(sql).all(...(params as never[])) as T[],
		run: (sql, params = []) => {
			db.query(sql).run(...(params as never[]));
		},
		transaction: (fn) => db.transaction(fn)(),
	};
}

export function openStore(path: string): UpdateStore {
	if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
	const db = new Database(path);
	db.exec("PRAGMA journal_mode = WAL");
	return new SqlUpdateStore(bunDriver(db));
}

interface SocketData {
	peer?: Peer;
}

export function startServer(options: {
	port: number;
	store: UpdateStore;
	hostname?: string;
	/** Directory for uploaded files. */
	blobDir?: string;
}) {
	const room = new Room(options.store);
	const app = createApp(new DiskBlobStore(options.blobDir ?? "data/blobs"));

	const server = Bun.serve<SocketData>({
		port: options.port,
		hostname: options.hostname,
		fetch(req, srv) {
			const url = new URL(req.url);
			if (url.pathname === "/sync") {
				if (srv.upgrade(req, { data: {} })) return undefined;
				return new Response("Expected a WebSocket upgrade", { status: 426 });
			}
			return app.fetch(req);
		},
		websocket: {
			maxPayloadLength: MAX_FRAME_BYTES,
			open(ws) {
				ws.data.peer = room.join({
					send: (data) => ws.sendBinary(data),
					close: (code, reason) => ws.close(code, reason),
				});
			},
			message(ws, message) {
				if (typeof message === "string") {
					if (message === PING) ws.send(PONG);
					return;
				}
				// Copy: Bun may reuse the buffer once this handler returns.
				void ws.data.peer?.receive(new Uint8Array(message));
			},
			close(ws) {
				ws.data.peer?.leave();
			},
		},
	});

	return { server, room };
}

if (import.meta.main) {
	const port = Number(process.env.PORT ?? 8787);
	const dbPath = process.env.SEIJAKU_DB ?? "data/seijaku.sqlite";
	const { server } = startServer({
		port,
		store: openStore(dbPath),
		blobDir: process.env.SEIJAKU_BLOBS ?? "data/blobs",
	});
	console.log(
		`Seijaku server on http://localhost:${server.port} (db: ${dbPath})`,
	);
}
