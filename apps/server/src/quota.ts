import { blobOwner } from "@seijaku/db";
import { eq, sum } from "drizzle-orm";
import type { AccountDb } from "./db";

/**
 * Per-account limits on what the server stores. Notes themselves are only counted by the
 * sync log limit. Whoever runs the server sets them with
 * QUOTA_FILES_MB (attachments, snapshots and published pages), QUOTA_SNAPSHOTS, QUOTA_SHARES and
 * QUOTA_SYNC_MB (the encrypted sync log; a shared page counts on its own), each a number or 0 for
 * no limit.
 */
export interface Limits {
	/** Sealed bytes of attachments, version snapshots and published pages together. */
	fileBytes: number;
	snapshots: number;
	shares: number;
	/** Sealed bytes of the sync log (an account's notes, or one shared page). */
	logBytes: number;
}

export const DEFAULT_LIMITS: Limits = {
	fileBytes: 500 * 1024 * 1024,
	snapshots: 5000,
	shares: 100,
	logBytes: 1024 * 1024 * 1024,
};

export function limitsFromEnv(
	env: Record<string, string | undefined> = {},
): Limits {
	const num = (v: string | undefined, fallback: number) => {
		const n = Number(v);
		return v !== undefined && v !== "" && Number.isFinite(n) && n >= 0
			? n
			: fallback;
	};
	return {
		fileBytes:
			num(env.QUOTA_FILES_MB, DEFAULT_LIMITS.fileBytes / 1048576) * 1048576,
		snapshots: num(env.QUOTA_SNAPSHOTS, DEFAULT_LIMITS.snapshots),
		shares: num(env.QUOTA_SHARES, DEFAULT_LIMITS.shares),
		logBytes:
			num(env.QUOTA_SYNC_MB, DEFAULT_LIMITS.logBytes / 1048576) * 1048576,
	};
}

/** True when `used + extra` goes past `limit` (0 means no limit). */
export const over = (used: number, extra: number, limit: number): boolean =>
	limit > 0 && used + extra > limit;

/**
 * Records a stored blob against its account and says whether the account stays within `limit`
 * (0: no limit). Counted first and checked after, so two uploads at once cannot both slip
 * under it. A blob already on record always fits, which keeps a retried upload harmless.
 */
export async function chargeBlob(
	db: AccountDb,
	userId: string,
	blobId: string,
	size: number,
	limit: number,
): Promise<boolean> {
	const [known] = await db
		.select({ id: blobOwner.blobId })
		.from(blobOwner)
		.where(eq(blobOwner.blobId, blobId))
		.limit(1);
	if (known) return true;
	await db
		.insert(blobOwner)
		.values({ blobId, userId, size })
		.onConflictDoNothing();
	const [row] = await db
		.select({ used: sum(blobOwner.size) })
		.from(blobOwner)
		.where(eq(blobOwner.userId, userId));
	if (limit > 0 && Number(row?.used ?? 0) > limit) {
		await db.delete(blobOwner).where(eq(blobOwner.blobId, blobId));
		return false;
	}
	return true;
}

/** The blob is gone: it no longer counts. */
export async function releaseBlob(
	db: AccountDb,
	blobId: string,
): Promise<void> {
	await db.delete(blobOwner).where(eq(blobOwner.blobId, blobId));
}
