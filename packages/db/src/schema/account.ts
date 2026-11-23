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

/** An account's X25519 public key, so page keys can be sealed to it. The private half never leaves its devices. */
export const accountKey = sqliteTable("account_key", {
	userId: text("user_id").primaryKey(),
	publicKey: text("public_key").notNull(),
});

/** A page shared with other accounts. Its content lives in a room of its own, named by this id. */
export const sharedPage = sqliteTable(
	"shared_page",
	{
		id: text("id").primaryKey(),
		ownerId: text("owner_id").notNull(),
		/** Bumped when someone is removed and the page key changes. */
		epoch: integer("epoch").notNull().default(0),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
	},
	(t) => [index("shared_page_by_owner").on(t.ownerId)],
);

/** Who may open a shared page. role is owner, editor or reader; the server enforces it on every push. */
export const shareMember = sqliteTable(
	"share_member",
	{
		id: text("id").primaryKey(),
		shareId: text("share_id").notNull(),
		userId: text("user_id").notNull(),
		role: text("role").notNull(),
		epoch: integer("epoch").notNull().default(0),
		/** The page key sealed to this member's public key, set when the key rotates. Opaque to the server. */
		wrappedKey: text("wrapped_key"),
		/** What the owner called the invite, shown in the people list. */
		label: text("label").notNull().default(""),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
	},
	(t) => [
		uniqueIndex("share_member_by_page_user").on(t.shareId, t.userId),
		index("share_member_by_user").on(t.userId),
	],
);

/** A one-use link to join a shared page. The page key inside is sealed under a secret only the link holds. */
export const shareInvite = sqliteTable(
	"share_invite",
	{
		id: text("id").primaryKey(),
		shareId: text("share_id").notNull(),
		role: text("role").notNull(),
		label: text("label").notNull().default(""),
		wrapped: text("wrapped").notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
	},
	(t) => [index("share_invite_by_page").on(t.shareId)],
);
