/**
 * Per-account limits on what the server stores. Notes themselves are never counted: only
 * attachments, version snapshots and public links. Whoever runs the server sets them with
 * QUOTA_FILES_MB, QUOTA_SNAPSHOTS and QUOTA_SHARES (a number, or 0 for no limit).
 */
export interface Limits {
	fileBytes: number;
	snapshots: number;
	shares: number;
}

export const DEFAULT_LIMITS: Limits = {
	fileBytes: 500 * 1024 * 1024,
	snapshots: 5000,
	shares: 100,
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
	};
}

/** True when `used + extra` goes past `limit` (0 means no limit). */
export const over = (used: number, extra: number, limit: number): boolean =>
	limit > 0 && used + extra > limit;
