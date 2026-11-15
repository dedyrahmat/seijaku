import type { UpdateStore } from "@seijaku/sync";

/**
 * The little SQL surface the update log needs. Bun's `bun:sqlite` and the Cloudflare
 * Durable Object's SQLite both fit behind it, so the storage logic is written once
 * and shared code never imports a runtime-specific module.
 */
export interface SqlDriver {
	exec(sql: string): void;
	all<T>(sql: string, params?: unknown[]): T[];
	run(sql: string, params?: unknown[]): void;
	transaction(fn: () => void): void;
}

export class SqlUpdateStore implements UpdateStore {
	constructor(private db: SqlDriver) {
		db.exec(
			`CREATE TABLE IF NOT EXISTS doc_updates (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				doc_id TEXT NOT NULL,
				data BLOB NOT NULL
			)`,
		);
		db.exec(
			"CREATE INDEX IF NOT EXISTS doc_updates_by_doc ON doc_updates (doc_id, id)",
		);
	}

	load(docId: string): Uint8Array[] {
		const rows = this.db.all<{ data: ArrayBuffer | Uint8Array }>(
			"SELECT data FROM doc_updates WHERE doc_id = ? ORDER BY id",
			[docId],
		);
		return rows.map((r) =>
			r.data instanceof Uint8Array ? r.data : new Uint8Array(r.data),
		);
	}

	append(docId: string, update: Uint8Array): void {
		this.db.run("INSERT INTO doc_updates (doc_id, data) VALUES (?, ?)", [
			docId,
			update,
		]);
	}

	replaceAll(docId: string, merged: Uint8Array): void {
		this.db.transaction(() => {
			this.db.run("DELETE FROM doc_updates WHERE doc_id = ?", [docId]);
			this.db.run("INSERT INTO doc_updates (doc_id, data) VALUES (?, ?)", [
				docId,
				merged,
			]);
		});
	}
}
