import { createApp } from "./app";
import {
	type AuthService,
	createAuthService,
	resolveSecret,
	rpIdFor,
} from "./auth";
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
		const made = createAuthService({
			database: env.DB,
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
			const userId = await auth.userId(request.headers);
			if (!userId) return new Response("Sign in first", { status: 401 });
			const id = env.WORKSPACE_ROOM.idFromName(userId);
			return env.WORKSPACE_ROOM.get(id).fetch(request);
		}
		return createApp(new R2BlobStore(env.BLOBS), auth).fetch(request, env, ctx);
	},
};
