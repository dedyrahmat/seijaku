import { passkey } from "@better-auth/passkey";
import { keyWrap } from "@seijaku/db";
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
import { bearer } from "better-auth/plugins";
import { and, count, eq } from "drizzle-orm";
import * as z from "zod";
import type { AccountDb } from "./db";

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
	/** Drizzle over the same database, for the tables this server adds (key wraps, history, shares). */
	db: AccountDb;
	/** Addresses people open the app at. The first is the canonical one. */
	origins: string[];
	/** WebAuthn relying-party id: the bare domain passkeys are bound to. */
	rpID: string;
	secret: string;
	/** A sign-up code every new account must enter. Unset: sign-up is open. */
	setupToken?: string | undefined;
	/**
	 * The request header that carries the client's address, set by a proxy this deployment
	 * controls (Cloudflare: cf-connecting-ip). Unset, no header is believed.
	 */
	ipHeader?: string | undefined;
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

export function safeEqual(a: string, b: string): boolean {
	const x = new TextEncoder().encode(a);
	const y = new TextEncoder().encode(b);
	let diff = x.length ^ y.length;
	for (let i = 0; i < Math.max(x.length, y.length); i++)
		diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
	return diff === 0;
}

/** What the server keeps of a phrase's login key: enough to recognise it, not to use it elsewhere. */
export async function hashLogin(
	secret: string,
	loginKey: string,
): Promise<string> {
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

/** Origins the desktop app runs from (Windows, then macOS and Linux); it signs in with a bearer token, not cookies. */
export const DESKTOP_ORIGINS = ["http://tauri.localhost", "tauri://localhost"];

const DESKTOP_CODE_SECONDS = 120;
/** More than anyone registers; replacing a passkey's wrap does not count twice. */
const MAX_PASSKEY_WRAPS = 50;
/** A sign-in this recent counts as proof of who is at the keyboard. */
export const FRESH_SECONDS = 120;

/** True when `loginKey` is the one the account's recovery phrase makes. */
export async function phraseMatches(
	config: Pick<AuthConfig, "db" | "secret">,
	userId: string,
	loginKey: string,
): Promise<boolean> {
	const [row] = await config.db
		.select({ loginHash: keyWrap.loginHash })
		.from(keyWrap)
		.where(and(eq(keyWrap.userId, userId), eq(keyWrap.kind, "phrase")))
		.limit(1);
	return (
		!!row?.loginHash &&
		safeEqual(row.loginHash, await hashLogin(config.secret, loginKey))
	);
}

/**
 * A short-lived code that turns a signed-in browser into a desktop sign-in: the user id and an
 * expiry, signed with the server secret. shortcut: a code can be used again until it expires
 * (2 minutes); it only travels through the local seijaku:// link, so one-time storage was skipped.
 */
async function desktopCode(secret: string, userId: string): Promise<string> {
	const body = `${userId}.${Math.floor(Date.now() / 1000) + DESKTOP_CODE_SECONDS}`;
	return `${body}.${await hashLogin(`${secret}/desktop-code`, body)}`;
}

async function userOfDesktopCode(
	secret: string,
	code: string,
): Promise<string | null> {
	const cut = code.lastIndexOf(".");
	const body = code.slice(0, cut);
	if (
		cut < 0 ||
		!safeEqual(
			code.slice(cut + 1),
			await hashLogin(`${secret}/desktop-code`, body),
		)
	)
		return null;
	const [userId, expires] = body.split(".");
	return userId && Number(expires) > Date.now() / 1000 ? userId : null;
}

/** A WebSocket cannot send headers, so the desktop app puts its token in the address instead. */
export function socketHeaders(req: Request): Headers {
	const token = new URL(req.url).searchParams.get("token");
	if (!token || req.headers.has("authorization")) return req.headers;
	const headers = new Headers(req.headers);
	headers.set("authorization", `Bearer ${token}`);
	return headers;
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
					await config.db.insert(keyWrap).values({
						id: crypto.randomUUID(),
						userId: user.id,
						kind: "phrase",
						ref: "",
						loginHash: await hashLogin(config.secret, ctx.body.loginKey),
						wrapped: ctx.body.wrapped,
						createdAt: new Date(),
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
					const loginHash = await hashLogin(config.secret, ctx.body.loginKey);
					const [row] = await config.db
						.select({ userId: keyWrap.userId, wrapped: keyWrap.wrapped })
						.from(keyWrap)
						.where(
							and(eq(keyWrap.kind, "phrase"), eq(keyWrap.loginHash, loginHash)),
						)
						.limit(1);
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

			/** Browser side of desktop sign-in: a code the desktop app trades for its own session. */
			seijakuDesktopCode: createAuthEndpoint(
				"/seijaku/desktop-code",
				{ method: "POST", use: [sessionMiddleware] },
				async (ctx) =>
					ctx.json({
						code: await desktopCode(config.secret, ctx.context.session.user.id),
					}),
			),

			/** Desktop side: trades the code for a session; the bearer plugin returns its token in a header. */
			seijakuDesktopExchange: createAuthEndpoint(
				"/seijaku/desktop-exchange",
				{
					method: "POST",
					body: z.object({ code: z.string().min(20).max(300) }),
				},
				async (ctx) => {
					const userId = await userOfDesktopCode(config.secret, ctx.body.code);
					const user = userId
						? await ctx.context.internalAdapter.findUserById(userId)
						: null;
					if (!user)
						throw new APIError("UNAUTHORIZED", {
							message:
								"That sign-in link has expired. Start again from the app.",
						});
					// Made from another session, not from proof of who holds the account: it must not count
					// as a recent sign-in, so it is dated as if it were old (its expiry is unchanged).
					const session = await ctx.context.internalAdapter.createSession(
						user.id,
						false,
						{ createdAt: new Date(0) },
						true,
					);
					await setSessionCookie(ctx, { session, user });
					return ctx.json({ ok: true });
				},
			),

			/** Every wrapped copy of the workspace key, for a signed-in device to open with what it holds. */
			seijakuKeyWraps: createAuthEndpoint(
				"/seijaku/key-wraps",
				{ method: "GET", use: [sessionMiddleware] },
				async (ctx) => {
					const rows = await config.db
						.select({
							kind: keyWrap.kind,
							ref: keyWrap.ref,
							wrapped: keyWrap.wrapped,
						})
						.from(keyWrap)
						.where(eq(keyWrap.userId, ctx.context.session.user.id));
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
							/** The phrase being replaced; not needed straight after signing in. */
							currentLoginKey: z.string().min(20).max(200).optional(),
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
					const body = ctx.body;
					const ref = body.kind === "passkey" ? body.ref : "";
					if (body.kind === "phrase") {
						// Replacing the phrase locks the owner out of recovery, so a stolen session is not enough:
						// it takes the current phrase, or a sign-in made moments ago.
						const [existing] = await config.db
							.select({ id: keyWrap.id })
							.from(keyWrap)
							.where(
								and(eq(keyWrap.userId, userId), eq(keyWrap.kind, "phrase")),
							)
							.limit(1);
						const fresh =
							Date.now() -
								new Date(ctx.context.session.session.createdAt).getTime() <
							FRESH_SECONDS * 1000;
						const proven =
							!existing ||
							fresh ||
							(!!body.currentLoginKey &&
								(await phraseMatches(config, userId, body.currentLoginKey)));
						if (!proven)
							throw new APIError("FORBIDDEN", {
								message: "Enter your current recovery phrase first.",
							});
					} else {
						const [have] = await config.db
							.select({ n: count() })
							.from(keyWrap)
							.where(
								and(eq(keyWrap.userId, userId), eq(keyWrap.kind, "passkey")),
							);
						if ((have?.n ?? 0) >= MAX_PASSKEY_WRAPS)
							throw new APIError("BAD_REQUEST", {
								message: "Too many passkeys.",
							});
					}
					await config.db
						.delete(keyWrap)
						.where(
							and(
								eq(keyWrap.userId, userId),
								eq(keyWrap.kind, body.kind),
								eq(keyWrap.ref, ref),
							),
						);
					await config.db.insert(keyWrap).values({
						id: crypto.randomUUID(),
						userId,
						kind: body.kind,
						ref,
						loginHash:
							body.kind === "phrase"
								? await hashLogin(config.secret, body.loginKey)
								: null,
						wrapped: body.wrapped,
						createdAt: new Date(),
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
		trustedOrigins: [...config.origins, ...DESKTOP_ORIGINS],
		session: { expiresIn: 60 * 60 * 24 * 90, updateAge: 60 * 60 * 24 },
		advanced: {
			cookiePrefix: "seijaku",
			// Only a header the deployment sets itself can be trusted; any other is the client's to forge.
			// Without one, rate limits share a single bucket.
			ipAddress: {
				ipAddressHeaders: config.ipHeader ? [config.ipHeader] : [],
			},
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
			bearer(),
		],
	});
}

export type Auth = ReturnType<typeof createAuth>;

export interface AuthService {
	auth: Auth;
	/** The account tables, for routes that keep their own data. */
	db: AccountDb;
	/** The server secret, for hashing what must match what is stored. */
	secret: string;
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
		db: config.db,
		secret: config.secret,
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
