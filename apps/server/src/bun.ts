import { Database } from "bun:sqlite";
import { lookup } from "node:dns/promises";
import { mkdirSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { accountMigrations, journalOf, logMigrations } from "@seijaku/db";
import {
	MAX_FRAME_BYTES,
	type Peer,
	PING,
	PONG,
	Room,
	type UpdateStore,
} from "@seijaku/sync";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { createApp } from "./app";
import {
	type AuthService,
	createAuthService,
	resolveSecret,
	rpIdFor,
	socketHeaders,
} from "./auth";
import { DiskBlobStore } from "./disk-blobs";
import { limitsFromEnv } from "./quota";
import { SqlUpdateStore } from "./sql-store";
import { isPrivateHost } from "./unfurl";

/** Self-host entry point: Hono over `Bun.serve`, one in-process room per account, bun:sqlite on disk. */

/** Opens the database once; each account's log is the same table under its own id prefix. */
export function openStore(path: string): (userId: string) => UpdateStore {
	if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
	const client = new Database(path);
	client.exec("PRAGMA journal_mode = WAL");
	const db = drizzle({ client });
	migrate(db, {
		migrationsJournal: journalOf(logMigrations),
		migrationsTable: "__drizzle_migrations_log",
	});
	return (userId) => new SqlUpdateStore(db, userId);
}

/** A file from the web build, or its index.html for an app route; null when nothing fits. */
function staticFile(dir: string, pathname: string): Response | null {
	let clean: string;
	try {
		clean = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, "");
	} catch {
		return null; // malformed % escape
	}
	// A path that climbs out of the folder never matches a file here.
	const asset = clean.startsWith("..") ? null : Bun.file(join(dir, clean));
	if (asset && clean !== "" && asset.size > 0)
		return new Response(asset, {
			// Vite names built assets by content, so they never change.
			headers: clean.startsWith("assets/")
				? { "Cache-Control": "public, max-age=31536000, immutable" }
				: { "Cache-Control": "no-cache" }, // sw.js and the manifest must revalidate
		});
	// A missing file (a script, an image) is a 404, not the app: only extensionless paths are app routes.
	if (/\.[a-z0-9]+$/i.test(clean)) return null;
	const index = Bun.file(join(dir, "index.html"));
	return index.size > 0
		? new Response(index, { headers: { "Cache-Control": "no-cache" } })
		: null;
}

/** A name is fetched only if everything it resolves to is outside the local network; returns the address to connect to. */
async function publicHost(host: string): Promise<string | null> {
	try {
		const found = await lookup(host, { all: true });
		return found.length > 0 && !found.some((a) => isPrivateHost(a.address))
			? (found[0]?.address ?? null)
			: null;
	} catch {
		return null;
	}
}

interface SocketData {
	userId: string;
	peer?: Peer;
}

export function startServer(options: {
	port: number;
	/** The log for one account ("" when there is no sign-in). */
	store: (userId: string) => UpdateStore;
	hostname?: string;
	/** Directory for uploaded files. */
	blobDir?: string;
	/** A built web app to serve for any page the API does not answer (single-page fallback). */
	webDir?: string;
	/** Sign-in. Left out only by tests: without it the server is open to anyone. */
	auth?: AuthService;
}) {
	const rooms = new Map<string, Room>();
	const roomFor = (userId: string) => {
		const found = rooms.get(userId);
		if (found) return found;
		const room = new Room(options.store(userId));
		rooms.set(userId, room);
		return room;
	};
	const app = createApp(
		new DiskBlobStore(options.blobDir ?? "data/blobs"),
		options.auth,
		{ resolveHost: publicHost },
		async (userId) => {
			const room = rooms.get(userId);
			if (room) {
				room.closeAll(4001, "account deleted");
				await room.flush();
				rooms.delete(userId);
			}
			await options.store(userId).deleteAll();
		},
		limitsFromEnv(process.env),
	);

	const server = Bun.serve<SocketData>({
		port: options.port,
		hostname: options.hostname,
		async fetch(req, srv) {
			const url = new URL(req.url);
			if (url.pathname === "/sync") {
				const userId = options.auth
					? await options.auth.userId(socketHeaders(req))
					: "";
				if (userId === null)
					return new Response("Sign in first", { status: 401 });
				if (srv.upgrade(req, { data: { userId } })) return undefined;
				return new Response("Expected a WebSocket upgrade", { status: 426 });
			}
			const res = await app.fetch(req);
			if (res.status !== 404 || !options.webDir) return res;
			if (req.method !== "GET" && req.method !== "HEAD") return res;
			if (url.pathname.startsWith("/api/")) return res;
			return staticFile(options.webDir, url.pathname) ?? res;
		},
		websocket: {
			maxPayloadLength: MAX_FRAME_BYTES,
			open(ws) {
				ws.data.peer = roomFor(ws.data.userId).join({
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

	return {
		server,
		flush: () => Promise.all([...rooms.values()].map((r) => r.flush())),
	};
}

/** The sign-in service, kept in the same SQLite file as the notes. */
export async function openAuth(
	dbPath: string,
	env: Record<string, string | undefined>,
	port: number,
): Promise<AuthService> {
	if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
	const db = new Database(dbPath);
	db.exec("PRAGMA journal_mode = WAL");
	db.exec(
		"CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
	);
	const secret = await resolveSecret(env.AUTH_SECRET, {
		get: async () => {
			const row = db
				.query("SELECT value FROM meta WHERE key = 'auth_secret'")
				.get() as { value: string } | null;
			return row?.value ?? null;
		},
		set: async (value) => {
			db.query(
				"INSERT OR REPLACE INTO meta (key, value) VALUES ('auth_secret', ?)",
			).run(value);
		},
	});
	// Through the Vite dev server the page is on 5173 while this server has its own port.
	const origins = (
		env.SEIJAKU_ORIGIN ?? `http://localhost:5173,http://localhost:${port}`
	)
		.split(",")
		.map((o) => o.trim().replace(/\/+$/, ""))
		.filter(Boolean);
	const accounts = drizzle({ client: db });
	migrate(accounts, {
		migrationsJournal: journalOf(accountMigrations),
		migrationsTable: "__drizzle_migrations_account",
	});
	const service = createAuthService({
		database: db,
		db: accounts,
		origins,
		rpID: rpIdFor(origins[0] as string, env.SEIJAKU_RP_ID),
		secret,
		setupToken: env.SETUP_TOKEN,
	});
	await service.ready;
	return service;
}

if (import.meta.main) {
	const port = Number(process.env.PORT ?? 8791);
	const dbPath = process.env.SEIJAKU_DB ?? "data/seijaku.sqlite";
	const auth = await openAuth(dbPath, process.env, port);
	const { server } = startServer({
		port,
		store: openStore(dbPath),
		blobDir: process.env.SEIJAKU_BLOBS ?? "data/blobs",
		webDir: process.env.SEIJAKU_WEB ?? join(import.meta.dir, "../../web/dist"),
		auth,
	});
	console.log(
		`Seijaku server on http://localhost:${server.port} (db: ${dbPath})`,
	);
	console.log(
		process.env.SETUP_TOKEN
			? "Sign-up needs the SETUP_TOKEN code."
			: "Sign-up is open. Set SETUP_TOKEN to require a code.",
	);
}
