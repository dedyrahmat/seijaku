import { blobOwner, docVersion, keyWrap, shareLink } from "@seijaku/db";
import { and, eq } from "drizzle-orm";
import type { Hono } from "hono";
import * as z from "zod";
import { type AuthService, hashLogin } from "./auth";
import { BLOB_ID, type BlobStore } from "./blobs";
import {
	noSharedHooks,
	removeAccountFromShares,
	type SharedHooks,
} from "./shared";

/** A passkey sign-in counts as proof for this long. */
const FRESH_SECONDS = 120;

/**
 * Deletes the signed-in account and everything the server holds for it: the sync log, every
 * file, snapshot and share link, the key wraps, passkeys, sessions and the user row. The caller
 * proves it is the owner with the phrase's login key, or with a passkey sign-in made in the
 * last two minutes (which leaves a fresh session). Data goes first and the user row last, so a
 * request that fails halfway can be sent again and finishes the job.
 *
 * shortcut: files uploaded before `blob_owner` existed have no recorded owner and stay in the
 * blob store (sealed, unreadable); sweep them if that ever matters.
 */
export function mountAccount(
	app: Hono,
	auth: AuthService,
	blobs: BlobStore,
	wipeLog: (userId: string) => Promise<void>,
	shared: SharedHooks = noSharedHooks,
): void {
	app.delete("/api/account", async (c) => {
		const headers = c.req.raw.headers;
		const found = await auth.userId(headers);
		if (!found) return c.json({ error: "sign in first" }, 401);
		const userId: string = found;
		const parsed = z
			.object({ loginKey: z.string().min(20).max(200).optional() })
			.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "bad request" }, 400);

		const d = auth.db;
		const { loginKey } = parsed.data;
		let proven = false;
		if (loginKey) {
			const [row] = await d
				.select({ loginHash: keyWrap.loginHash })
				.from(keyWrap)
				.where(and(eq(keyWrap.userId, userId), eq(keyWrap.kind, "phrase")))
				.limit(1);
			proven =
				!!row?.loginHash &&
				row.loginHash === (await hashLogin(auth.secret, loginKey));
		} else {
			const current = await auth.auth.api.getSession({ headers });
			proven =
				!!current &&
				Date.now() - new Date(current.session.createdAt).getTime() <
					FRESH_SECONDS * 1000;
		}
		if (!proven) return c.json({ error: "not confirmed" }, 403);

		await wipeLog(userId);
		await removeAccountFromShares(auth, shared, userId);
		const owned = await Promise.all([
			d
				.select({ id: docVersion.blobId })
				.from(docVersion)
				.where(eq(docVersion.userId, userId)),
			d
				.select({ id: shareLink.blobId })
				.from(shareLink)
				.where(eq(shareLink.userId, userId)),
			d
				.select({ id: blobOwner.blobId })
				.from(blobOwner)
				.where(eq(blobOwner.userId, userId)),
		]);
		for (const { id } of owned.flat())
			if (BLOB_ID.test(id)) await blobs.delete(id);
		await d.delete(docVersion).where(eq(docVersion.userId, userId));
		await d.delete(shareLink).where(eq(shareLink.userId, userId));
		await d.delete(blobOwner).where(eq(blobOwner.userId, userId));

		const context = await auth.auth.$context;
		await context.adapter.deleteMany({
			model: "passkey",
			where: [{ field: "userId", value: userId }],
		});
		await d.delete(keyWrap).where(eq(keyWrap.userId, userId));
		await context.internalAdapter.deleteUser(userId);
		return c.json({ ok: true });
	});
}
