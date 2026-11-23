import { docVersion, shareLink } from "@seijaku/db";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import type { Hono } from "hono";
import * as z from "zod";
import type { AuthService } from "./auth";
import { BLOB_ID, type BlobStore, MAX_UPLOAD_BYTES, newBlobId } from "./blobs";
import { DEFAULT_LIMITS, type Limits, over } from "./quota";

/**
 * Version history and public share links. Both hold only sealed bytes: the app seals a note's
 * snapshot with the workspace key, and a shared page with a key that lives in the link's
 * #fragment, so this server can list and serve them but never read them. Snapshots go in the
 * blob store; the database keeps who, when and which blob.
 */

const MIN = 60_000;
const DAY = 86_400_000;
const HARD_CAP = 200;

/**
 * Which snapshots to keep: everything from the last hour; within a day, one per ten minutes;
 * within a month, one per day; older, one per week; never more than 200. The newest of each bucket survives.
 * `keepDays` (the "Keep version history" setting) drops anything older, or null for no limit.
 */
export function versionsToKeep(
	versions: { id: string; at: number }[],
	now: number,
	keepDays: number | null = null,
): Set<string> {
	const newestFirst = [...versions].sort((a, b) => b.at - a.at);
	const seen = new Set<string>();
	const keep = new Set<string>();
	for (const v of newestFirst) {
		const age = now - v.at;
		if (keepDays !== null && age > keepDays * DAY) continue;
		const bucket =
			age < 60 * MIN
				? `i${v.id}`
				: age < DAY
					? `m${Math.floor(v.at / (10 * MIN))}`
					: age < 30 * DAY
						? `d${Math.floor(v.at / DAY)}`
						: `w${Math.floor(v.at / (7 * DAY))}`;
		if (seen.has(bucket)) continue;
		seen.add(bucket);
		keep.add(v.id);
		if (keep.size >= HARD_CAP) break;
	}
	return keep;
}

const DOC = /^d[a-f0-9]{32}$/;
const TOKEN = /^[A-Za-z0-9_-]{16}$/;

/** Standard or URL-safe base64, with or without padding. */
function fromBase64(text: string): Uint8Array {
	const pad = "=".repeat((4 - (text.length % 4)) % 4);
	const plain = text.replace(/-/g, "+").replace(/_/g, "/") + pad;
	return Uint8Array.from(atob(plain), (c) => c.charCodeAt(0));
}

function newToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(12));
	return btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, "-")
		.replace(/\//g, "_");
}

const octet = (body: BodyInit | null, extra: HeadersInit = {}) =>
	new Response(body, {
		headers: {
			"Content-Type": "application/octet-stream",
			"X-Content-Type-Options": "nosniff",
			"Cache-Control": "private, no-store",
			...extra,
		},
	});

export function mountHistory(
	app: Hono,
	auth: AuthService,
	blobs: BlobStore,
	limits: Limits = DEFAULT_LIMITS,
): void {
	const db = async () => {
		await auth.ready;
		return auth.db;
	};

	const newVersion = z.object({
		doc: z.string().regex(DOC),
		meta: z.string().min(1).max(2000),
		data: z.string().min(1),
		keepDays: z.number().int().min(1).max(3650).nullable().optional(),
	});

	app.post("/api/versions", async (c) => {
		const userId = await auth.userId(c.req.raw.headers);
		if (!userId) return c.json({ error: "sign in first" }, 401);
		const parsed = newVersion.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return c.json({ error: "bad request" }, 400);
		const { doc, meta, data, keepDays } = parsed.data;
		let bytes: Uint8Array;
		try {
			bytes = fromBase64(data);
		} catch {
			return c.json({ error: "bad request" }, 400);
		}
		if (bytes.byteLength > MAX_UPLOAD_BYTES)
			return c.json({ error: "too large" }, 413);

		const d = await db();
		const blobId = newBlobId();
		await blobs.put(blobId, bytes.buffer as ArrayBuffer, {
			type: "application/octet-stream",
			size: bytes.byteLength,
		});
		const id = crypto.randomUUID();
		await d
			.insert(docVersion)
			.values({ id, userId, doc, meta, blobId, createdAt: new Date() });

		const all = await d
			.select({
				id: docVersion.id,
				blobId: docVersion.blobId,
				createdAt: docVersion.createdAt,
			})
			.from(docVersion)
			.where(and(eq(docVersion.userId, userId), eq(docVersion.doc, doc)));
		const keep = versionsToKeep(
			all.map((v) => ({ id: v.id, at: v.createdAt.getTime() })),
			Date.now(),
			keepDays ?? null,
		);
		keep.add(id); // the one just made always stays
		const drop = all.filter((v) => !keep.has(v.id));
		if (drop.length > 0) {
			await d.delete(docVersion).where(
				inArray(
					docVersion.id,
					drop.map((v) => v.id),
				),
			);
			for (const v of drop) await blobs.delete(v.blobId).catch(() => undefined);
		}
		// Over the account's snapshot limit: the oldest go first, so history never stops.
		if (limits.snapshots > 0) {
			const [{ n } = { n: 0 }] = await d
				.select({ n: count() })
				.from(docVersion)
				.where(eq(docVersion.userId, userId));
			if (n > limits.snapshots) {
				const oldest = await d
					.select({ id: docVersion.id, blobId: docVersion.blobId })
					.from(docVersion)
					.where(eq(docVersion.userId, userId))
					.orderBy(asc(docVersion.createdAt))
					.limit(n - limits.snapshots);
				await d.delete(docVersion).where(
					inArray(
						docVersion.id,
						oldest.map((v) => v.id),
					),
				);
				for (const v of oldest)
					await blobs.delete(v.blobId).catch(() => undefined);
			}
		}
		return c.json({ id });
	});

	app.get("/api/versions", async (c) => {
		const userId = await auth.userId(c.req.raw.headers);
		if (!userId) return c.json({ error: "sign in first" }, 401);
		const doc = c.req.query("doc") ?? "";
		if (!DOC.test(doc)) return c.json({ error: "bad request" }, 400);
		const rows = await (await db())
			.select({
				id: docVersion.id,
				createdAt: docVersion.createdAt,
				meta: docVersion.meta,
			})
			.from(docVersion)
			.where(and(eq(docVersion.userId, userId), eq(docVersion.doc, doc)));
		return c.json(
			rows
				.map((v) => ({
					id: v.id,
					createdAt: v.createdAt.getTime(),
					meta: v.meta,
				}))
				.sort((a, b) => b.createdAt - a.createdAt),
		);
	});

	// A note was deleted for good: remove its snapshots too.
	app.delete("/api/versions", async (c) => {
		const userId = await auth.userId(c.req.raw.headers);
		if (!userId) return c.json({ error: "sign in first" }, 401);
		const doc = c.req.query("doc") ?? "";
		if (!DOC.test(doc)) return c.json({ error: "bad request" }, 400);
		const d = await db();
		const where = and(eq(docVersion.userId, userId), eq(docVersion.doc, doc));
		const rows = await d
			.select({ blobId: docVersion.blobId })
			.from(docVersion)
			.where(where);
		for (const v of rows) await blobs.delete(v.blobId);
		await d.delete(docVersion).where(where);
		return c.json({ ok: true });
	});

	app.get("/api/versions/:id", async (c) => {
		const userId = await auth.userId(c.req.raw.headers);
		if (!userId) return c.json({ error: "sign in first" }, 401);
		const [row] = await (await db())
			.select({ blobId: docVersion.blobId })
			.from(docVersion)
			.where(
				and(
					eq(docVersion.id, c.req.param("id")),
					eq(docVersion.userId, userId),
				),
			)
			.limit(1);
		const found =
			row && BLOB_ID.test(row.blobId) ? await blobs.get(row.blobId) : null;
		if (!found) return c.json({ error: "not found" }, 404);
		return octet(found.body as BodyInit);
	});

	const publish = z.object({
		token: z.string().regex(TOKEN).optional(),
		data: z.string().min(1),
		/** Epoch ms; null for never. Left out, an existing link keeps its date. */
		expiresAt: z.number().int().positive().nullable().optional(),
	});

	// Creates a share, or replaces the page behind an existing one (same link, new content).
	app.put("/api/shares", async (c) => {
		const userId = await auth.userId(c.req.raw.headers);
		if (!userId) return c.json({ error: "sign in first" }, 401);
		const parsed = publish.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return c.json({ error: "bad request" }, 400);
		let bytes: Uint8Array;
		try {
			bytes = fromBase64(parsed.data.data);
		} catch {
			return c.json({ error: "bad request" }, 400);
		}
		if (bytes.byteLength > MAX_UPLOAD_BYTES)
			return c.json({ error: "too large" }, 413);

		const d = await db();
		const [existing] = parsed.data.token
			? await d
					.select()
					.from(shareLink)
					.where(
						and(
							eq(shareLink.token, parsed.data.token),
							eq(shareLink.userId, userId),
						),
					)
					.limit(1)
			: [];
		if (!existing) {
			const [{ n } = { n: 0 }] = await d
				.select({ n: count() })
				.from(shareLink)
				.where(eq(shareLink.userId, userId));
			if (over(n, 1, limits.shares))
				return c.json(
					{ error: "quota", what: "shares", limit: limits.shares },
					413,
				);
		}
		const blobId = newBlobId();
		await blobs.put(blobId, bytes.buffer as ArrayBuffer, {
			type: "application/octet-stream",
			size: bytes.byteLength,
		});
		const expiresAt =
			parsed.data.expiresAt === undefined
				? undefined
				: parsed.data.expiresAt === null
					? null
					: new Date(parsed.data.expiresAt);
		if (existing) {
			await d
				.update(shareLink)
				.set({
					blobId,
					updatedAt: new Date(),
					...(expiresAt === undefined ? {} : { expiresAt }),
				})
				.where(eq(shareLink.id, existing.id));
			await blobs.delete(existing.blobId).catch(() => undefined);
			return c.json({
				token: existing.token,
				createdAt: existing.createdAt.getTime(),
			});
		}
		const now = new Date();
		const token = newToken();
		await d.insert(shareLink).values({
			id: crypto.randomUUID(),
			userId,
			token,
			blobId,
			createdAt: now,
			updatedAt: now,
			expiresAt: expiresAt ?? null,
		});
		return c.json({ token, createdAt: now.getTime() });
	});

	app.delete("/api/shares/:token", async (c) => {
		const userId = await auth.userId(c.req.raw.headers);
		if (!userId) return c.json({ error: "sign in first" }, 401);
		const d = await db();
		const [row] = await d
			.select()
			.from(shareLink)
			.where(
				and(
					eq(shareLink.token, c.req.param("token")),
					eq(shareLink.userId, userId),
				),
			)
			.limit(1);
		if (row) {
			await d.delete(shareLink).where(eq(shareLink.id, row.id));
			await blobs.delete(row.blobId).catch(() => undefined);
		}
		return c.json({ ok: true });
	});

	// Public: no session. The token is unguessable and the bytes are sealed under the link's key.
	app.get("/api/shares/:token", async (c) => {
		const token = c.req.param("token");
		if (!TOKEN.test(token)) return c.json({ error: "not found" }, 404);
		const [row] = await (await db())
			.select({
				blobId: shareLink.blobId,
				updatedAt: shareLink.updatedAt,
				expiresAt: shareLink.expiresAt,
			})
			.from(shareLink)
			.where(eq(shareLink.token, token))
			.limit(1);
		if (row?.expiresAt && row.expiresAt.getTime() <= Date.now())
			return c.json({ error: "expired" }, 410);
		const found =
			row && BLOB_ID.test(row.blobId) ? await blobs.get(row.blobId) : null;
		if (!row || !found) return c.json({ error: "not found" }, 404);
		return octet(found.body as BodyInit, {
			"X-Robots-Tag": "noindex",
			"X-Updated-At": String(row.updatedAt.getTime()),
		});
	});
}
