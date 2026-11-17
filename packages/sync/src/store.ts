export type MaybePromise<T> = T | Promise<T>;

export interface LogEntry {
	seq: number;
	data: Uint8Array;
}

/**
 * Durable log of sealed blobs, one log per doc. The Room is its only writer and serializes
 * calls per doc, so implementations need no locking of their own. The store never looks
 * inside a blob.
 *
 * Implementations: bun:sqlite (self-host) and Durable Object SQLite (Cloudflare), both in
 * apps/server; `MemoryUpdateStore` below is for tests.
 *
 * `seq` numbers only ever grow, and increase within every doc, but are shared across docs.
 */
export interface UpdateStore {
	/** Adds one blob to the end of the doc's log and returns its seq. */
	append(docId: string, data: Uint8Array): MaybePromise<number>;
	/** Entries with seq greater than `afterSeq`, oldest first. */
	loadAfter(docId: string, afterSeq: number): MaybePromise<LogEntry[]>;
	/** Highest seq in the doc's log (0 when empty) and how many entries it holds. */
	stat(docId: string): MaybePromise<{ head: number; count: number }>;
	/** Replaces every entry up to and including `upto` with one entry, kept at seq `upto`. */
	replaceUpTo(
		docId: string,
		upto: number,
		snapshot: Uint8Array,
	): MaybePromise<void>;
}

export class MemoryUpdateStore implements UpdateStore {
	readonly logs = new Map<string, LogEntry[]>();
	private next = 1;

	append(docId: string, data: Uint8Array): number {
		const seq = this.next++;
		const log = this.logs.get(docId);
		if (log) log.push({ seq, data });
		else this.logs.set(docId, [{ seq, data }]);
		return seq;
	}

	loadAfter(docId: string, afterSeq: number): LogEntry[] {
		return (this.logs.get(docId) ?? []).filter((e) => e.seq > afterSeq);
	}

	stat(docId: string): { head: number; count: number } {
		const log = this.logs.get(docId) ?? [];
		return { head: log.at(-1)?.seq ?? 0, count: log.length };
	}

	replaceUpTo(docId: string, upto: number, snapshot: Uint8Array): void {
		const log = this.logs.get(docId) ?? [];
		this.logs.set(docId, [
			{ seq: upto, data: snapshot },
			...log.filter((e) => e.seq > upto),
		]);
	}
}
