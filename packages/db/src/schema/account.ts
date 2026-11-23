import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Tables the server adds beside Better Auth's own (user, session, passkey, ...), which Better
 * Auth creates and migrates itself. Lives in the Bun database file, and in D1 on Cloudflare.
 * `user_id` points at Better Auth's `user.id`; it is not declared as a foreign key here so
 * drizzle-kit never tries to manage that table.
 */

/** One stored way to open an account's workspace key. The server cannot open it. */
export const keyWrap = sqliteTable(
	"key_wrap",
	{
		id: text("id").primaryKey(),
		userId: text("user_id").notNull(),
		/** "phrase" or "passkey". */
		kind: text("kind").notNull(),
		/** Which passkey, for kind "passkey"; empty for a phrase. */
		ref: text("ref").notNull(),
		/** Phrase only: an HMAC of the login key. */
		loginHash: text("login_hash"),
		wrapped: text("wrapped").notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
	},
	(t) => [
		index("key_wrap_by_user").on(t.userId),
		index("key_wrap_by_login").on(t.kind, t.loginHash),
	],
);

/** A sealed snapshot of one note. The bytes live in the blob store. */
export const docVersion = sqliteTable(
	"doc_version",
	{
		id: text("id").primaryKey(),
		userId: text("user_id").notNull(),
		/** The note's server name (an HMAC), never its id. */
		doc: text("doc").notNull(),
		/** Sealed words and device: small enough to list without opening snapshots. */
		meta: text("meta").notNull(),
		blobId: text("blob_id").notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
	},
	(t) => [index("doc_version_by_doc").on(t.userId, t.doc)],
);

/** A published copy of one note, sealed under a key only its link holds. */
export const shareLink = sqliteTable(
	"share_link",
	{
		id: text("id").primaryKey(),
		userId: text("user_id").notNull(),
		token: text("token").notNull(),
		blobId: text("blob_id").notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
		/** After this the link answers "expired" until its owner renews it. Null: never. */
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
	},
	(t) => [uniqueIndex("share_link_by_token").on(t.token)],
);

/** Who uploaded an attachment, so deleting an account can remove its files. The bytes live in the blob store. */
export const blobOwner = sqliteTable(
	"blob_owner",
	{
		blobId: text("blob_id").primaryKey(),
		userId: text("user_id").notNull(),
		/** Sealed size, for the storage limit. Files uploaded before limits existed read 0. */
		size: integer("size").notNull().default(0),
	},
	(t) => [index("blob_owner_by_user").on(t.userId)],
);
