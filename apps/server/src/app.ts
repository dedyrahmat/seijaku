import { Hono, type MiddlewareHandler } from "hono";
import type { AuthService } from "./auth";
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
import { UnfurlError, type UnfurlOptions, unfurl } from "./unfurl";

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
) {
	const app = new Hono();

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
		mountHistory(app, auth, blobs);
	}

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
		await blobs.put(id, data, { type, size: data.byteLength });
		return c.json({ id, url: `/api/files/${id}`, type, size: data.byteLength });
	});

	app.get("/api/unfurl", async (c) => {
		try {
			return c.json(await unfurl(c.req.query("url") ?? "", links));
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
