import {
	blob,
	index,
	integer,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";

/**
 * The sync log: sealed blobs in order, per doc. The server never opens them. Lives in the
 * Bun database file, and in each account's Durable Object on Cloudflare.
 */
export const docLog = sqliteTable(
	"doc_log",
	{
		seq: integer("seq").primaryKey({ autoIncrement: true }),
		docId: text("doc_id").notNull(),
		data: blob("data", { mode: "buffer" }).notNull(),
	},
	(t) => [index("doc_log_by_doc").on(t.docId, t.seq)],
);
