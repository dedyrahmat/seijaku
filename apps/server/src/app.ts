import { blobOwner, docVersion, shareLink } from "@seijaku/db";
import { count, eq, sum } from "drizzle-orm";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { mountAccount } from "./account";
import { type AuthService, DESKTOP_ORIGINS } from "./auth";
import {
	BLOB_ID,
	type BlobStore,
	blobIdFor,
	cleanType,
	isInlineType,
	MAX_UPLOAD_BYTES,
	newBlobId,
} from "./blobs";
import { mountHistory } from "./history";
import { DEFAULT_LIMITS, type Limits, over } from "./quota";
import {
	type Preview,
	UnfurlError,
	type UnfurlOptions,
	unfurl,
} from "./unfurl";

const PREVIEW_TTL = 60 * 60_000;

/**
 * The HTTP surface shared by both hosting targets. WebSocket upgrades are handled in the
 * runtime entry points (bun.ts, worker.ts) because they differ per runtime.
 * With `auth`, files need a session and the sign-in routes are served under /api/auth.
 * History and share routes join here in later phases.
 */
export function createApp(
	blobs: BlobStore,
	auth?: AuthService,
	links: UnfurlOptions = {},
	/** Removes an account's sync log (runtime specific), for account deletion. */
	wipeLog: (userId: string) => Promise<void> = async () => undefined,
	limits: Limits = DEFAULT_LIMITS,
) {
	const app = new Hono();

	// The desktop app calls from its own origin with a bearer token (no cookies are shared).
	app.use(
		"/api/*",
		cors({
			origin: DESKTOP_ORIGINS,
			allowHeaders: ["authorization", "content-type"],
			allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
			exposeHeaders: ["set-auth-token", "x-updated-at"],
		}),
	);

	if (auth) {
		app.on(["GET", "POST"], "/api/auth/*", async (c) => {
			await auth.ready;
			return auth.auth.handler(c.req.raw);
		});
		const needSession: MiddlewareHandler = async (c, next) => {
			if (!(await auth.userId(c.req.raw.headers)))
				return c.json({ error: "sign in first" }, 401);
			await next();
		};
		app.use("/api/files", needSession);
		app.use("/api/files/*", needSession);
		app.use("/api/unfurl", needSession);
		mountHistory(app, auth, blobs, limits);
		mountAccount(app, auth, blobs, wipeLog);
	}

	/**
	 * Remembers who uploaded a file (so deleting the account can remove it) and its size, and
	 * says whether it fits the account's storage limit. A file already on record always fits,
	 * which keeps a retried upload harmless.
	 */
	const reserve = async (
		headers: Headers,
		blobId: string,
		size: number,
	): Promise<boolean> => {
		const userId = await auth?.userId(headers);
		if (!auth || !userId) return true;
		const [known] = await auth.db
			.select({ id: blobOwner.blobId })
			.from(blobOwner)
			.where(eq(blobOwner.blobId, blobId))
			.limit(1);
		if (known) return true;
		const [row] = await auth.db
			.select({ used: sum(blobOwner.size) })
			.from(blobOwner)
			.where(eq(blobOwner.userId, userId));
		if (over(Number(row?.used ?? 0), size, limits.fileBytes)) return false;
		await auth.db
			.insert(blobOwner)
			.values({ blobId, userId, size })
			.onConflictDoNothing();
		return true;
	};
	const full = (c: Context) =>
		c.json({ error: "quota", what: "files", limit: limits.fileBytes }, 413);

	app.get("/api/usage", async (c) => {
		const userId = auth && (await auth.userId(c.req.raw.headers));
		if (!auth || !userId) return c.json({ error: "sign in first" }, 401);
		await auth.ready;
		const one = async (q: Promise<{ n: unknown }[]>) =>
			Number((await q)[0]?.n ?? 0);
		return c.json({
			files: {
				used: await one(
					auth.db
						.select({ n: sum(blobOwner.size) })
						.from(blobOwner)
						.where(eq(blobOwner.userId, userId)),
				),
				limit: limits.fileBytes,
			},
			snapshots: {
				used: await one(
					auth.db
						.select({ n: count() })
						.from(docVersion)
						.where(eq(docVersion.userId, userId)),
				),
				limit: limits.snapshots,
			},
			shares: {
				used: await one(
					auth.db
						.select({ n: count() })
						.from(shareLink)
						.where(eq(shareLink.userId, userId)),
				),
				limit: limits.shares,
			},
		});
	});

	app.get("/api/health", (c) => c.json({ ok: true }));

	// Upload: raw bytes as the body, content type in the header.
	app.post("/api/files", async (c) => {
		const declared = Number(c.req.header("content-length") ?? 0);
		if (declared > MAX_UPLOAD_BYTES) return c.json({ error: "too large" }, 413);
		const data = await c.req.arrayBuffer();
		if (data.byteLength === 0) return c.json({ error: "empty" }, 400);
		if (data.byteLength > MAX_UPLOAD_BYTES)
			return c.json({ error: "too large" }, 413);
		const id = newBlobId();
		const type = cleanType(c.req.header("content-type"));
		if (!(await reserve(c.req.raw.headers, id, data.byteLength)))
			return full(c);
		await blobs.put(id, data, { type, size: data.byteLength });
		return c.json({ id, url: `/api/files/${id}`, type, size: data.byteLength });
	});

	// Upload under the file's own address (see blobIdFor). Repeating it is harmless, which is
	// what lets the app retry an upload that was queued offline.
	app.put("/api/files/:id", async (c) => {
		const id = c.req.param("id");
		if (!BLOB_ID.test(id)) return c.json({ error: "bad id" }, 400);
		const declared = Number(c.req.header("content-length") ?? 0);
		if (declared > MAX_UPLOAD_BYTES) return c.json({ error: "too large" }, 413);
		const data = await c.req.arrayBuffer();
		if (data.byteLength === 0) return c.json({ error: "empty" }, 400);
		if (data.byteLength > MAX_UPLOAD_BYTES)
			return c.json({ error: "too large" }, 413);
		if ((await blobIdFor(data)) !== id)
			return c.json({ error: "address does not match the bytes" }, 400);
		const type = cleanType(c.req.header("content-type"));
		if (!(await reserve(c.req.raw.headers, id, data.byteLength)))
			return full(c);
		await blobs.put(id, data, { type, size: data.byteLength });
		return c.json({ id, url: `/api/files/${id}`, type, size: data.byteLength });
	});

	// Previews are the same for everyone, so a recent answer is reused (per process; on
	// Cloudflare per isolate). Failures are not remembered.
	const previews = new Map<string, { at: number; preview: Preview }>();
	app.get("/api/unfurl", async (c) => {
		const key = c.req.query("url") ?? "";
		const hit = previews.get(key);
		if (hit && Date.now() - hit.at < PREVIEW_TTL) return c.json(hit.preview);
		try {
			const preview = await unfurl(key, links);
			previews.delete(key);
			previews.set(key, { at: Date.now(), preview });
			if (previews.size > 500)
				previews.delete(previews.keys().next().value as string);
			return c.json(preview);
		} catch (err) {
			if (err instanceof UnfurlError)
				return c.json({ error: err.message }, 422);
			throw err;
		}
	});

	app.get("/api/files/:id", async (c) => {
		const id = c.req.param("id");
		if (!BLOB_ID.test(id)) return c.notFound();
		const found = await blobs.get(id);
		if (!found) return c.notFound();
		const inline = isInlineType(found.info.type);
		const headers = new Headers({
			"Content-Type": inline ? found.info.type : "application/octet-stream",
			"X-Content-Type-Options": "nosniff",
			// A file opened directly can never run script or reach the app's storage.
			"Content-Security-Policy":
				"sandbox; default-src 'none'; style-src 'unsafe-inline'",
			"Cache-Control": "public, max-age=31536000, immutable",
			"Content-Length": String(found.info.size),
		});
		if (!inline) headers.set("Content-Disposition", "attachment");
		return new Response(found.body, { headers });
	});

	return app;
}
