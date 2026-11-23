import { accountMigrations } from "@seijaku/db";
import { drizzle } from "drizzle-orm/d1";
import { createApp } from "./app";
import {
	type AuthService,
	createAuthService,
	resolveSecret,
	rpIdFor,
	socketHeaders,
} from "./auth";
import { limitsFromEnv } from "./quota";
import { R2BlobStore } from "./r2-blobs";

export { WorkspaceRoom } from "./room-do";

interface Env {
	WORKSPACE_ROOM: DurableObjectNamespace;
	BLOBS: R2Bucket;
	/** Accounts, sessions and passkeys. */
	DB: D1Database;
	/** Optional sign-up code. Set with `wrangler secret put SETUP_TOKEN`; unset, anyone can sign up. */
	SETUP_TOKEN?: string;
	/** At least 32 characters. Made and kept in D1 when not set. */
	AUTH_SECRET?: string;
	/** Comma-separated addresses the app is opened at; the request's own origin when unset. */
	SEIJAKU_ORIGIN?: string;
	SEIJAKU_RP_ID?: string;
}

/**
 * Applies the account migrations to D1. Drizzle's own D1 migrator reads a folder, which a
 * Worker does not have, so this runs the bundled SQL and keeps its own list of what ran.
 */
async function migrateD1(d1: D1Database): Promise<void> {
	await d1.exec(
		"CREATE TABLE IF NOT EXISTS seijaku_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)",
	);
	const { results } = await d1
		.prepare("SELECT name FROM seijaku_migrations")
		.all<{ name: string }>();
	const done = new Set(results.map((r) => r.name));
	for (const name of Object.keys(accountMigrations).sort()) {
		if (done.has(name)) continue;
		const statements = (accountMigrations[name] as string)
			.split("--> statement-breakpoint")
			.map((part) => part.trim())
			.filter(Boolean)
			.map((part) => d1.prepare(part));
		statements.push(
			d1
				.prepare(
					"INSERT INTO seijaku_migrations (name, applied_at) VALUES (?, ?)",
				)
				.bind(name, Date.now()),
		);
		await d1.batch(statements);
	}
}

let service: Promise<AuthService> | undefined;

/** One sign-in service per isolate, made on the first request. */
function authFor(env: Env, requestOrigin: string): Promise<AuthService> {
	service ??= (async () => {
		await env.DB.exec(
			"CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
		);
		const secret = await resolveSecret(env.AUTH_SECRET, {
			get: async () =>
				(
					await env.DB.prepare(
						"SELECT value FROM meta WHERE key = 'auth_secret'",
					).first<{ value: string }>()
				)?.value ?? null,
			set: async (value) => {
				await env.DB.prepare(
					"INSERT OR REPLACE INTO meta (key, value) VALUES ('auth_secret', ?)",
				)
					.bind(value)
					.run();
			},
		});
		const origins = (env.SEIJAKU_ORIGIN ?? requestOrigin)
			.split(",")
			.map((o) => o.trim().replace(/\/+$/, ""))
			.filter(Boolean);
		await migrateD1(env.DB);
		const made = createAuthService({
			database: env.DB,
			db: drizzle(env.DB),
			origins,
			rpID: rpIdFor(origins[0] as string, env.SEIJAKU_RP_ID),
			secret,
			setupToken: env.SETUP_TOKEN,
		});
		await made.ready;
		return made;
	})();
	// A failed start must not be remembered, or the isolate stays broken.
	service.catch(() => {
		service = undefined;
	});
	return service;
}

/**
 * Cloudflare entry point. HTTP goes to the shared Hono app; the sync WebSocket is handed to
 * the signed-in account's Durable Object (one per account, named by user id).
 */
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);
		const auth = await authFor(env, url.origin);
		if (url.pathname === "/sync") {
			if (request.headers.get("Upgrade") !== "websocket") {
				return new Response("Expected a WebSocket upgrade", { status: 426 });
			}
			const userId = await auth.userId(socketHeaders(request));
			if (!userId) return new Response("Sign in first", { status: 401 });
			const id = env.WORKSPACE_ROOM.idFromName(userId);
			return env.WORKSPACE_ROOM.get(id).fetch(request);
		}
		return createApp(
			new R2BlobStore(env.BLOBS),
			auth,
			{},
			async (userId) => {
				const room = env.WORKSPACE_ROOM.get(
					env.WORKSPACE_ROOM.idFromName(userId),
				);
				await room.fetch("https://room/wipe", { method: "DELETE" });
			},
			limitsFromEnv(env as unknown as Record<string, string | undefined>),
		).fetch(request, env, ctx);
	},
};
