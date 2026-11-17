import type { LogEntry, UpdateStore } from "@seijaku/sync";

/**
 * The little SQL surface the log needs. Bun's `bun:sqlite` and the Cloudflare
 * Durable Object's SQLite both fit behind it, so the storage logic is written once
 * and shared code never imports a runtime-specific module.
 */
export interface SqlDriver {
	exec(sql: string): void;
	all<T>(sql: string, params?: unknown[]): T[];
	run(sql: string, params?: unknown[]): void;
	transaction(fn: () => void): void;
}

/** Sealed blobs in order. The server never opens them: it cannot read a note. */
export class SqlUpdateStore implements UpdateStore {
	/** `scope` keeps accounts apart when they share one table: it prefixes every doc id. */
	constructor(
		private db: SqlDriver,
		private scope = "",
	) {
		db.exec(
			`CREATE TABLE IF NOT EXISTS doc_log (
				seq INTEGER PRIMARY KEY AUTOINCREMENT,
				doc_id TEXT NOT NULL,
				data BLOB NOT NULL
			)`,
		);
		db.exec(
			"CREATE INDEX IF NOT EXISTS doc_log_by_doc ON doc_log (doc_id, seq)",
		);
	}

	append(docId: string, data: Uint8Array): number {
		docId = this.scope + docId;
		const rows = this.db.all<{ seq: number }>(
			"INSERT INTO doc_log (doc_id, data) VALUES (?, ?) RETURNING seq",
			[docId, data],
		);
		return Number(rows[0]?.seq);
	}

	loadAfter(docId: string, afterSeq: number): LogEntry[] {
		docId = this.scope + docId;
		const rows = this.db.all<{
			seq: number;
			data: ArrayBuffer | Uint8Array;
		}>(
			"SELECT seq, data FROM doc_log WHERE doc_id = ? AND seq > ? ORDER BY seq",
			[docId, afterSeq],
		);
		return rows.map((r) => ({
			seq: Number(r.seq),
			data: r.data instanceof Uint8Array ? r.data : new Uint8Array(r.data),
		}));
	}

	stat(docId: string): { head: number; count: number } {
		docId = this.scope + docId;
		const [row] = this.db.all<{ head: number; count: number }>(
			"SELECT COALESCE(MAX(seq), 0) AS head, COUNT(*) AS count FROM doc_log WHERE doc_id = ?",
			[docId],
		);
		return { head: Number(row?.head ?? 0), count: Number(row?.count ?? 0) };
	}

	replaceUpTo(docId: string, upto: number, snapshot: Uint8Array): void {
		docId = this.scope + docId;
		this.db.transaction(() => {
			this.db.run("DELETE FROM doc_log WHERE doc_id = ? AND seq <= ?", [
				docId,
				upto,
			]);
			this.db.run("INSERT INTO doc_log (seq, doc_id, data) VALUES (?, ?, ?)", [
				upto,
				docId,
				snapshot,
			]);
		});
	}
}
