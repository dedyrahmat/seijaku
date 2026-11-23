import { accountKey, sharedPage, shareInvite, shareMember } from "@seijaku/db";
import { and, eq } from "drizzle-orm";
import type { Hono } from "hono";
import * as z from "zod";
import type { AuthService } from "./auth";

/**
 * Pages shared with other accounts (docs/COLLABORATIVE-SHARING.md). The server keeps who may
 * open which page and in what role; the content is sealed under a page key it never sees. A
 * shared page has a room of its own, named by its id, and these routes decide who may join it.
 */

export type Role = "owner" | "editor" | "reader";
const INVITE_DAYS = 7;
const DAY = 86_400_000;

/** What the runtime does to a shared page's room (Bun: in-process rooms; Cloudflare: its Durable Object). */
export interface SharedHooks {
	/** Disconnects everyone and drops the page's whole log (key rotated, or sharing stopped). */
	reset(shareId: string): Promise<void>;
	/** Disconnects one member's devices so a removal or role change takes effect now. */
	kick(shareId: string, userId: string): Promise<void>;
}

export const noSharedHooks: SharedHooks = {
	reset: async () => undefined,
	kick: async () => undefined,
};

const ID = /^[a-f0-9]{20}$/;
const newId = () => {
	const bytes = crypto.getRandomValues(new Uint8Array(10));
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

/** The role a user has on a page, or null. Used before a socket is accepted. */
export async function sharedRole(
	auth: AuthService,
	shareId: string,
	userId: string,
): Promise<Role | null> {
	if (!ID.test(shareId)) return null;
	await auth.ready;
	const [row] = await auth.db
		.select({ role: shareMember.role })
		.from(shareMember)
		.where(
			and(eq(shareMember.shareId, shareId), eq(shareMember.userId, userId)),
		)
		.limit(1);
	return (row?.role as Role | undefined) ?? null;
}

/** Removes a shared page and everything the server holds about it. */
export async function dropSharedPage(
	auth: AuthService,
	hooks: SharedHooks,
	shareId: string,
): Promise<void> {
	await hooks.reset(shareId);
	const d = auth.db;
	await d.delete(shareInvite).where(eq(shareInvite.shareId, shareId));
	await d.delete(shareMember).where(eq(shareMember.shareId, shareId));
	await d.delete(sharedPage).where(eq(sharedPage.id, shareId));
}

export function mountShared(
	app: Hono,
	auth: AuthService,
	hooks: SharedHooks,
): void {
	const d = () => auth.db;
	const me = async (headers: Headers) => {
		await auth.ready;
		return auth.userId(headers);
	};
	const base64 = z.string().min(1).max(4000);
	const roleOf = z.enum(["editor", "reader"]);

	const ownerOf = async (shareId: string, userId: string) => {
		if (!ID.test(shareId)) return null;
		const [page] = await d()
			.select()
			.from(sharedPage)
			.where(eq(sharedPage.id, shareId))
			.limit(1);
		return page && page.ownerId === userId ? page : null;
	};

	// An account publishes the public half of its key pair once.
	app.put("/api/shared/key", async (c) => {
		const userId = await me(c.req.raw.headers);
		if (!userId) return c.json({ error: "sign in first" }, 401);
		const parsed = z
			.object({ publicKey: base64 })
			.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return c.json({ error: "bad request" }, 400);
		await d()
			.insert(accountKey)
			.values({ userId, publicKey: parsed.data.publicKey })
			.onConflictDoUpdate({
				target: accountKey.userId,
				set: { publicKey: parsed.data.publicKey },
			});
		return c.json({ ok: true });
	});

	// Every page this account owns or was invited to.
	app.get("/api/shared", async (c) => {
		const userId = await me(c.req.raw.headers);
		if (!userId) return c.json({ error: "sign in first" }, 401);
		const rows = await d()
			.select()
			.from(shareMember)
			.where(eq(shareMember.userId, userId));
		return c.json(
			rows.map((m) => ({
				id: m.shareId,
				memberId: m.id,
				role: m.role,
				epoch: m.epoch,
				wrappedKey: m.wrappedKey,
			})),
		);
	});

	// The owner turns a page into a shared page.
	app.post("/api/shared", async (c) => {
		const userId = await me(c.req.raw.headers);
		if (!userId) return c.json({ error: "sign in first" }, 401);
		const id = newId();
		const now = new Date();
		await d()
			.insert(sharedPage)
			.values({ id, ownerId: userId, epoch: 0, createdAt: now });
		await d().insert(shareMember).values({
			id: newId(),
			shareId: id,
			userId,
			role: "owner",
			epoch: 0,
			createdAt: now,
		});
		return c.json({ id, epoch: 0 });
	});

	// The owner stops sharing: the room, members and invites all go.
	app.delete("/api/shared/:id", async (c) => {
		const userId = await me(c.req.raw.headers);
		if (!userId) return c.json({ error: "sign in first" }, 401);
		const shareId = c.req.param("id");
		if (!(await ownerOf(shareId, userId)))
			return c.json({ error: "not found" }, 404);
		await dropSharedPage(auth, hooks, shareId);
		return c.json({ ok: true });
	});

	app.post("/api/shared/:id/invites", async (c) => {
		const userId = await me(c.req.raw.headers);
		if (!userId) return c.json({ error: "sign in first" }, 401);
		const shareId = c.req.param("id");
		if (!(await ownerOf(shareId, userId)))
			return c.json({ error: "not found" }, 404);
		const parsed = z
			.object({
				role: roleOf,
				label: z.string().max(60).default(""),
				wrapped: base64,
			})
			.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return c.json({ error: "bad request" }, 400);
		const id = newId() + newId(); // 40 hex: unguessable
		const now = Date.now();
		const expiresAt = now + INVITE_DAYS * DAY;
		await d()
			.insert(shareInvite)
			.values({
				id,
				shareId,
				...parsed.data,
				createdAt: new Date(now),
				expiresAt: new Date(expiresAt),
			});
		return c.json({ id, expiresAt });
	});

	app.get("/api/shared/:id/invites", async (c) => {
		const userId = await me(c.req.raw.headers);
		if (!userId) return c.json({ error: "sign in first" }, 401);
		const shareId = c.req.param("id");
		if (!(await ownerOf(shareId, userId)))
			return c.json({ error: "not found" }, 404);
		const rows = await d()
			.select()
			.from(shareInvite)
			.where(eq(shareInvite.shareId, shareId));
		return c.json(
			rows.map((i) => ({
				id: i.id,
				role: i.role,
				label: i.label,
				expiresAt: i.expiresAt.getTime(),
			})),
		);
	});

	app.delete("/api/shared/:id/invites/:invite", async (c) => {
		const userId = await me(c.req.raw.headers);
		if (!userId) return c.json({ error: "sign in first" }, 401);
		const shareId = c.req.param("id");
		if (!(await ownerOf(shareId, userId)))
			return c.json({ error: "not found" }, 404);
		await d()
			.delete(shareInvite)
			.where(
				and(
					eq(shareInvite.id, c.req.param("invite")),
					eq(shareInvite.shareId, shareId),
				),
			);
		return c.json({ ok: true });
	});

	// Opening an invite link: whoever holds the id gets the sealed key (only the link's secret opens it).
	app.get("/api/invites/:id", async (c) => {
		const userId = await me(c.req.raw.headers);
		if (!userId) return c.json({ error: "sign in first" }, 401);
		const [inv] = await d()
			.select()
			.from(shareInvite)
			.where(eq(shareInvite.id, c.req.param("id")))
			.limit(1);
		if (!inv || inv.expiresAt.getTime() < Date.now())
			return c.json({ error: "not found" }, 404);
		return c.json({
			shareId: inv.shareId,
			role: inv.role,
			label: inv.label,
			wrapped: inv.wrapped,
		});
	});

	app.post("/api/invites/:id/claim", async (c) => {
		const userId = await me(c.req.raw.headers);
		if (!userId) return c.json({ error: "sign in first" }, 401);
		const parsed = z
			.object({ publicKey: base64 })
			.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return c.json({ error: "bad request" }, 400);
		const [inv] = await d()
			.select()
			.from(shareInvite)
			.where(eq(shareInvite.id, c.req.param("id")))
			.limit(1);
		if (!inv || inv.expiresAt.getTime() < Date.now())
			return c.json({ error: "not found" }, 404);
		const [page] = await d()
			.select()
			.from(sharedPage)
			.where(eq(sharedPage.id, inv.shareId))
			.limit(1);
		if (!page) return c.json({ error: "not found" }, 404);
		if (await sharedRole(auth, inv.shareId, userId))
			return c.json({ error: "already a member" }, 409);
		await d()
			.insert(accountKey)
			.values({ userId, publicKey: parsed.data.publicKey })
			.onConflictDoUpdate({
				target: accountKey.userId,
				set: { publicKey: parsed.data.publicKey },
			});
		await d().insert(shareMember).values({
			id: newId(),
			shareId: inv.shareId,
			userId,
			role: inv.role,
			epoch: page.epoch,
			label: inv.label,
			createdAt: new Date(),
		});
		await d().delete(shareInvite).where(eq(shareInvite.id, inv.id)); // one use
		return c.json({ shareId: inv.shareId, role: inv.role, epoch: page.epoch });
	});

	// The owner's people list, with the public keys needed to wrap a new page key.
	app.get("/api/shared/:id/members", async (c) => {
		const userId = await me(c.req.raw.headers);
		if (!userId) return c.json({ error: "sign in first" }, 401);
		const shareId = c.req.param("id");
		if (!(await ownerOf(shareId, userId)))
			return c.json({ error: "not found" }, 404);
		const rows = await d()
			.select({ m: shareMember, key: accountKey.publicKey })
			.from(shareMember)
			.leftJoin(accountKey, eq(accountKey.userId, shareMember.userId))
			.where(eq(shareMember.shareId, shareId));
		return c.json(
			rows.map(({ m, key }) => ({
				memberId: m.id,
				role: m.role,
				label: m.label,
				epoch: m.epoch,
				publicKey: key,
				you: m.userId === userId,
			})),
		);
	});

	app.patch("/api/shared/:id/members/:member", async (c) => {
		const userId = await me(c.req.raw.headers);
		if (!userId) return c.json({ error: "sign in first" }, 401);
		const shareId = c.req.param("id");
		if (!(await ownerOf(shareId, userId)))
			return c.json({ error: "not found" }, 404);
		const parsed = z
			.object({ role: roleOf })
			.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return c.json({ error: "bad request" }, 400);
		const [row] = await d()
			.select()
			.from(shareMember)
			.where(
				and(
					eq(shareMember.id, c.req.param("member")),
					eq(shareMember.shareId, shareId),
				),
			)
			.limit(1);
		if (!row || row.role === "owner")
			return c.json({ error: "not found" }, 404);
		await d()
			.update(shareMember)
			.set({ role: parsed.data.role })
			.where(eq(shareMember.id, row.id));
		await hooks.kick(shareId, row.userId); // reconnects with the new role
		return c.json({ ok: true });
	});

	// The owner removes someone, or a member leaves (their own member id).
	app.delete("/api/shared/:id/members/:member", async (c) => {
		const userId = await me(c.req.raw.headers);
		if (!userId) return c.json({ error: "sign in first" }, 401);
		const shareId = c.req.param("id");
		const [row] = await d()
			.select()
			.from(shareMember)
			.where(
				and(
					eq(shareMember.id, c.req.param("member")),
					eq(shareMember.shareId, shareId),
				),
			)
			.limit(1);
		if (!row || row.role === "owner")
			return c.json({ error: "not found" }, 404);
		const owner = await ownerOf(shareId, userId);
		if (!owner && row.userId !== userId)
			return c.json({ error: "not found" }, 404);
		await d().delete(shareMember).where(eq(shareMember.id, row.id));
		await hooks.kick(shareId, row.userId);
		return c.json({ ok: true });
	});

	// After a removal: a new epoch. Everyone left gets the new page key sealed to them, and the
	// room starts empty; the owner's device pushes the page's state again under the new key.
	app.post("/api/shared/:id/rotate", async (c) => {
		const userId = await me(c.req.raw.headers);
		if (!userId) return c.json({ error: "sign in first" }, 401);
		const shareId = c.req.param("id");
		const page = await ownerOf(shareId, userId);
		if (!page) return c.json({ error: "not found" }, 404);
		const parsed = z
			.object({
				wraps: z.array(z.object({ memberId: z.string(), wrapped: base64 })),
			})
			.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return c.json({ error: "bad request" }, 400);
		const others = (
			await d()
				.select()
				.from(shareMember)
				.where(eq(shareMember.shareId, shareId))
		).filter((m) => m.role !== "owner");
		const wanted = new Set(others.map((m) => m.id));
		const given = new Set(parsed.data.wraps.map((w) => w.memberId));
		if (wanted.size !== given.size || [...wanted].some((m) => !given.has(m)))
			return c.json({ error: "a key is needed for every member" }, 400);

		const epoch = page.epoch + 1;
		await d()
			.update(sharedPage)
			.set({ epoch })
			.where(eq(sharedPage.id, shareId));
		for (const w of parsed.data.wraps)
			await d()
				.update(shareMember)
				.set({ epoch, wrappedKey: w.wrapped })
				.where(eq(shareMember.id, w.memberId));
		await d()
			.update(shareMember)
			.set({ epoch })
			.where(
				and(eq(shareMember.shareId, shareId), eq(shareMember.role, "owner")),
			);
		await hooks.reset(shareId);
		return c.json({ epoch });
	});
}

/** For account deletion: leave every page, and stop the ones the account owns. */
export async function removeAccountFromShares(
	auth: AuthService,
	hooks: SharedHooks,
	userId: string,
): Promise<void> {
	const d = auth.db;
	const owned = await d
		.select({ id: sharedPage.id })
		.from(sharedPage)
		.where(eq(sharedPage.ownerId, userId));
	for (const p of owned) await dropSharedPage(auth, hooks, p.id);
	const mine = await d
		.select({ shareId: shareMember.shareId })
		.from(shareMember)
		.where(eq(shareMember.userId, userId));
	if (mine.length > 0) {
		await d.delete(shareMember).where(eq(shareMember.userId, userId));
		for (const m of mine) await hooks.kick(m.shareId, userId);
	}
	await d.delete(accountKey).where(eq(accountKey.userId, userId));
}
