export type MaybePromise<T> = T | Promise<T>;

/**
 * Durable log of Yjs updates, one log per doc. The Room is its only writer, and it
 * serializes calls per doc, so implementations need no locking of their own.
 *
 * Implementations: bun:sqlite (self-host) and Durable Object SQLite (Cloudflare),
 * both in apps/server; `MemoryUpdateStore` below is for tests.
 */
export interface UpdateStore {
	/** Every stored update for the doc, oldest first. Empty for an unknown doc. */
	load(docId: string): MaybePromise<Uint8Array[]>;
	/** Adds one update to the end of the doc's log. */
	append(docId: string, update: Uint8Array): MaybePromise<void>;
	/** Replaces the doc's whole log with one merged update (compaction). */
	replaceAll(docId: string, merged: Uint8Array): MaybePromise<void>;
}

export class MemoryUpdateStore implements UpdateStore {
	readonly logs = new Map<string, Uint8Array[]>();

	load(docId: string): Uint8Array[] {
		return [...(this.logs.get(docId) ?? [])];
	}

	append(docId: string, update: Uint8Array): void {
		const log = this.logs.get(docId);
		if (log) log.push(update);
		else this.logs.set(docId, [update]);
	}

	replaceAll(docId: string, merged: Uint8Array): void {
		this.logs.set(docId, [merged]);
	}
}
