import type { NoteMeta } from "./workspace";

/** The ids from `a` to `b` inclusive, in `order` (the order rows are on screen). Unknown ids give just `b`. */
export function rangeBetween(order: string[], a: string, b: string): string[] {
	const i = order.indexOf(a);
	const j = order.indexOf(b);
	if (i < 0 || j < 0) return [b];
	return order.slice(Math.min(i, j), Math.max(i, j) + 1);
}

/**
 * Drops ids that sit under another id in the set. Trashing or deleting the parent already takes
 * them along, and trashing them too would leave them in the trash on their own after a restore.
 */
export function withoutDescendants(
	notes: NoteMeta[],
	ids: Iterable<string>,
): string[] {
	const set = new Set(ids);
	const byId = new Map(notes.map((n) => [n.id, n]));
	return [...set].filter((id) => {
		const seen = new Set<string>([id]);
		let cur = byId.get(id)?.parentId;
		while (cur && !seen.has(cur)) {
			if (set.has(cur)) return false;
			seen.add(cur);
			cur = byId.get(cur)?.parentId;
		}
		return true;
	});
}
