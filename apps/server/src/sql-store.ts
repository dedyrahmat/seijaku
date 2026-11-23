import { docLog } from "@seijaku/db";
import type { LogEntry, UpdateStore } from "@seijaku/sync";
import { and, asc, count, eq, gt, lte, max, sql } from "drizzle-orm";
import type { LogDb } from "./db";

/**
 * What a blob column takes: a Node Buffer where there is one (Bun, Workers with nodejs_compat).
 * Named through globalThis so shared code does not depend on Node's types.
 */
const toBlob = (bytes: Uint8Array): never => {
	const node = (globalThis as { Buffer?: { from(b: Uint8Array): unknown } })
		.Buffer;
	return (node ? node.from(bytes) : bytes) as never;
};

/** Sealed blobs in order. The server never opens them: it cannot read a note. */
export class SqlUpdateStore implements UpdateStore {
	/** `scope` keeps accounts apart when they share one table: it prefixes every doc id. */
	constructor(
		private db: LogDb,
		private scope = "",
	) {}

	append(docId: string, data: Uint8Array): number {
		const [row] = this.db
			.insert(docLog)
			.values({ docId: this.scope + docId, data: toBlob(data) })
			.returning({ seq: docLog.seq })
			.all();
		return Number(row?.seq);
	}

	loadAfter(docId: string, afterSeq: number): LogEntry[] {
		return this.db
			.select({ seq: docLog.seq, data: docLog.data })
			.from(docLog)
			.where(
				and(eq(docLog.docId, this.scope + docId), gt(docLog.seq, afterSeq)),
			)
			.orderBy(asc(docLog.seq))
			.all()
			.map((r) => ({
				seq: Number(r.seq),
				data: new Uint8Array(r.data),
			}));
	}

	stat(docId: string): { head: number; count: number } {
		const [row] = this.db
			.select({
				head: sql<number>`coalesce(${max(docLog.seq)}, 0)`,
				count: count(),
			})
			.from(docLog)
			.where(eq(docLog.docId, this.scope + docId))
			.all();
		return { head: Number(row?.head ?? 0), count: Number(row?.count ?? 0) };
	}

	deleteDoc(docId: string): void {
		this.db
			.delete(docLog)
			.where(eq(docLog.docId, this.scope + docId))
			.run();
	}

	/** Removes this scope's logs; with no scope (a Durable Object, one account) that is the whole table. */
	deleteAll(): void {
		this.db
			.delete(docLog)
			.where(
				this.scope
					? sql`substr(${docLog.docId}, 1, ${this.scope.length}) = ${this.scope}`
					: undefined,
			)
			.run();
	}

	bytes(): number {
		const [row] = this.db
			.select({ n: sql<number>`coalesce(sum(length(${docLog.data})), 0)` })
			.from(docLog)
			.where(
				this.scope
					? sql`substr(${docLog.docId}, 1, ${this.scope.length}) = ${this.scope}`
					: undefined,
			)
			.all();
		return Number(row?.n ?? 0);
	}

	replaceUpTo(docId: string, upto: number, snapshot: Uint8Array): void {
		const id = this.scope + docId;
		this.db.transaction((tx) => {
			tx.delete(docLog)
				.where(and(eq(docLog.docId, id), lte(docLog.seq, upto)))
				.run();
			tx.insert(docLog)
				.values({ seq: upto, docId: id, data: toBlob(snapshot) })
				.run();
		});
	}
}
