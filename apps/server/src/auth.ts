import { passkey } from "@better-auth/passkey";
import {
	type BetterAuthOptions,
	type BetterAuthPlugin,
	betterAuth,
	type GenericEndpointContext,
} from "better-auth";
import {
	APIError,
	createAuthEndpoint,
	getSessionFromCtx,
	sessionMiddleware,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { getMigrations } from "better-auth/db/migration";
import * as z from "zod";

/**
 * Accounts for an instance: anyone can create one. Better Auth owns users, sessions and passkeys;
 * this file adds what it does not: creating an account (with an optional sign-up code), the
 * recovery phrase (a second way to sign in), the wrapped copies of the workspace key, and one
 * status call the app asks on every start. Runs unchanged on Bun (bun:sqlite) and Cloudflare
 * (D1): the caller hands in whichever database it has.
 *
 * Notes are end-to-end encrypted, so this server never sees a phrase or a workspace key. It
 * stores a hash of the phrase's *login key* (to recognise the phrase) and the workspace key
 * wrapped under keys only the owner can make. Losing every wrapping secret loses the notes;
 * there is no reset.
 *
 * Every account has its own workspace. `setupToken`, when set, is a sign-up code each new
 * account must enter; unset, sign-up is open.
 */

export interface AuthConfig {
	/** A Bun `Database` or a D1 binding: whatever Better Auth's built-in adapters accept. */
	database: BetterAuthOptions["database"];
	/** Addresses people open the app at. The first is the canonical one. */
	origins: string[];
	/** WebAuthn relying-party id: the bare domain passkeys are bound to. */
	rpID: string;
	secret: string;
	/** A sign-up code every new account must enter. Unset: sign-up is open. */
	setupToken?: string | undefined;
}

export interface SeijakuStatus {
	signedIn: boolean;
	/** Creating an account needs the sign-up code. */
	codeRequired: boolean;
}

/** One stored way to open the workspace key. The server cannot open it. */
export interface KeyWrap {
	kind: "phrase" | "passkey";
	/** Which passkey, for kind "passkey". */
	ref: string;
	wrapped: string;
}

function safeEqual(a: string, b: string): boolean {
	const x = new TextEncoder().encode(a);
	const y = new TextEncoder().encode(b);
	let diff = x.length ^ y.length;
	for (let i = 0; i < Math.max(x.length, y.length); i++)
		diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
	return diff === 0;
}

/** What the server keeps of a phrase's login key: enough to recognise it, not to use it elsewhere. */
async function hashLogin(secret: string, loginKey: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(loginKey),
	);
	return Array.from(new Uint8Array(sig), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
}

/** Checks the sign-up code (when one is set) and makes a new account with a throwaway address. */
async function newAccount(
	ctx: GenericEndpointContext,
	config: AuthConfig,
	token: string | null | undefined,
) {
	if (config.setupToken && !safeEqual(token ?? "", config.setupToken))
		throw new APIError("UNAUTHORIZED", {
			message: "That sign-up code is not right.",
		});
	return ctx.context.internalAdapter.createUser(
		{
			email: `${crypto.randomUUID()}@seijaku.local`,
			name: "Account",
			emailVerified: true,
		},
		ctx,
	);
}

function seijakuPlugin(config: AuthConfig): BetterAuthPlugin {
	return {
		id: "seijaku",
		schema: {
			keyWrap: {
				fields: {
					userId: {
						type: "string",
						required: true,
						references: { model: "user", field: "id" },
					},
					kind: { type: "string", required: true },
					ref: { type: "string", required: true },
					/** Phrase only: a hash of the login key. */
					loginHash: { type: "string", required: false },
					wrapped: { type: "string", required: true },
					createdAt: { type: "date", required: true },
				},
			},
			/** A sealed snapshot of one note. The bytes live in the blob store. */
			version: {
				fields: {
					userId: {
						type: "string",
						required: true,
						references: { model: "user", field: "id" },
					},
					/** The note's server name (an HMAC), never its id. */
					doc: { type: "string", required: true, index: true },
					/** Sealed words and device: small enough to list without opening snapshots. */
					meta: { type: "string", required: true },
					blobId: { type: "string", required: true },
					createdAt: { type: "date", required: true },
				},
			},
			/** A published copy of one note, sealed under a key only the link holds. */
			share: {
				fields: {
					userId: {
						type: "string",
						required: true,
						references: { model: "user", field: "id" },
					},
					token: { type: "string", required: true, unique: true },
					blobId: { type: "string", required: true },
					createdAt: { type: "date", required: true },
					updatedAt: { type: "date", required: true },
				},
			},
		},
		endpoints: {
			seijakuStatus: createAuthEndpoint(
				"/seijaku/status",
				{ method: "GET" },
				async (ctx) => {
					const session = await getSessionFromCtx(ctx);
					const status: SeijakuStatus = {
						signedIn: Boolean(session),
						codeRequired: Boolean(config.setupToken),
					};
					return ctx.json(status);
				},
			),

			/** Creates an account with a phrase alone (no passkey): code if needed, login key, wrapped workspace key. */
			seijakuSignUp: createAuthEndpoint(
				"/seijaku/sign-up",
				{
					method: "POST",
					body: z.object({
						token: z.string().max(200).optional(),
						loginKey: z.string().min(20).max(200),
						wrapped: z.string().min(20).max(500),
					}),
				},
				async (ctx) => {
					const user = await newAccount(ctx, config, ctx.body.token);
					await ctx.context.adapter.create({
						model: "keyWrap",
						data: {
							userId: user.id,
							kind: "phrase",
							ref: "",
							loginHash: await hashLogin(config.secret, ctx.body.loginKey),
							wrapped: ctx.body.wrapped,
							createdAt: new Date(),
						},
					});
					const session = await ctx.context.internalAdapter.createSession(
						user.id,
					);
					await setSessionCookie(ctx, { session, user });
					return ctx.json({ ok: true });
				},
			),

			/** Signs in with the phrase's login key and hands back the wrapped workspace key. */
			seijakuPhrase: createAuthEndpoint(
				"/seijaku/phrase",
				{
					method: "POST",
					body: z.object({ loginKey: z.string().min(20).max(200) }),
				},
				async (ctx) => {
					const row = await ctx.context.adapter.findOne<{
						userId: string;
						wrapped: string;
					}>({
						model: "keyWrap",
						where: [
							{ field: "kind", value: "phrase" },
							{
								field: "loginHash",
								value: await hashLogin(config.secret, ctx.body.loginKey),
							},
						],
					});
					if (!row)
						throw new APIError("UNAUTHORIZED", {
							message: "That recovery phrase is not right.",
						});
					const user = await ctx.context.internalAdapter.findUserById(
						row.userId,
					);
					if (!user)
						throw new APIError("UNAUTHORIZED", { message: "No such account." });
					const session = await ctx.context.internalAdapter.createSession(
						user.id,
					);
					await setSessionCookie(ctx, { session, user });
					return ctx.json({ wrapped: row.wrapped });
				},
			),

			/** Every wrapped copy of the workspace key, for a signed-in device to open with what it holds. */
			seijakuKeyWraps: createAuthEndpoint(
				"/seijaku/key-wraps",
				{ method: "GET", use: [sessionMiddleware] },
				async (ctx) => {
					const rows = await ctx.context.adapter.findMany<KeyWrap>({
						model: "keyWrap",
						where: [{ field: "userId", value: ctx.context.session.user.id }],
					});
					return ctx.json(
						rows.map(({ kind, ref, wrapped }) => ({ kind, ref, wrapped })),
					);
				},
			),

			/**
			 * Stores a wrapped copy. A new phrase replaces the old one (the old phrase stops working);
			 * a passkey's copy is kept per passkey.
			 */
			seijakuSetKeyWrap: createAuthEndpoint(
				"/seijaku/key-wraps",
				{
					method: "POST",
					use: [sessionMiddleware],
					body: z.discriminatedUnion("kind", [
						z.object({
							kind: z.literal("phrase"),
							loginKey: z.string().min(20).max(200),
							wrapped: z.string().min(20).max(500),
						}),
						z.object({
							kind: z.literal("passkey"),
							ref: z.string().min(1).max(500),
							wrapped: z.string().min(20).max(500),
						}),
					]),
				},
				async (ctx) => {
					const userId = ctx.context.session.user.id;
					const adapter = ctx.context.adapter;
					const body = ctx.body;
					const ref = body.kind === "passkey" ? body.ref : "";
					await adapter.deleteMany({
						model: "keyWrap",
						where: [
							{ field: "userId", value: userId },
							{ field: "kind", value: body.kind },
							{ field: "ref", value: ref },
						],
					});
					await adapter.create({
						model: "keyWrap",
						data: {
							userId,
							kind: body.kind,
							ref,
							loginHash:
								body.kind === "phrase"
									? await hashLogin(config.secret, body.loginKey)
									: null,
							wrapped: body.wrapped,
							createdAt: new Date(),
						},
					});
					return ctx.json({ ok: true });
				},
			),
		},
		rateLimit: [
			{
				pathMatcher: (path) =>
					path === "/seijaku/phrase" || path === "/seijaku/sign-up",
				window: 900,
				max: 5,
			},
			{
				pathMatcher: (path) => path.startsWith("/passkey/generate-register"),
				window: 900,
				max: 20,
			},
		],
	};
}

export function createAuth(config: AuthConfig) {
	const [primary] = config.origins;
	if (!primary) throw new Error("At least one origin is required");
	return betterAuth({
		database: config.database,
		baseURL: primary,
		secret: config.secret,
		trustedOrigins: config.origins,
		session: { expiresIn: 60 * 60 * 24 * 90, updateAge: 60 * 60 * 24 },
		advanced: {
			cookiePrefix: "seijaku",
			ipAddress: { ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"] },
		},
		rateLimit: { enabled: true, storage: "database" },
		plugins: [
			passkey({
				rpID: config.rpID,
				rpName: "Seijaku",
				origin: config.origins,
				registration: {
					// Without a session this makes a new account; the sign-up code, if one is set, is the context.
					requireSession: false,
					resolveUser: async ({ ctx, context }) => {
						const user = await newAccount(ctx, config, context);
						return { id: user.id, name: user.email, displayName: "Account" };
					},
				},
			}),
			seijakuPlugin(config),
		],
	});
}

export type Auth = ReturnType<typeof createAuth>;

export interface AuthService {
	auth: Auth;
	/** Resolves once the auth tables exist. Await before the first request is served. */
	ready: Promise<void>;
	/** The signed-in account's id, or null when the request carries no valid session. */
	userId(headers: Headers): Promise<string | null>;
}

export function createAuthService(config: AuthConfig): AuthService {
	const auth = createAuth(config);
	const ready = getMigrations(auth.options).then((m) => m.runMigrations());
	return {
		auth,
		ready,
		userId: async (headers) => {
			await ready;
			return (await auth.api.getSession({ headers }))?.user.id ?? null;
		},
	};
}

/** Reads the secret from the environment, or makes one and keeps it with the data. */
export async function resolveSecret(
	fromEnv: string | undefined,
	store: {
		get(): Promise<string | null>;
		set(value: string): Promise<void>;
	},
): Promise<string> {
	if (fromEnv && fromEnv.length >= 32) return fromEnv;
	const saved = await store.get();
	if (saved) return saved;
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	const made = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
		"",
	);
	await store.set(made);
	return made;
}

/** "https://notes.example.com" -> "notes.example.com"; the passkey id when none is set. */
export function rpIdFor(origin: string, override?: string): string {
	return override || new URL(origin).hostname;
}
