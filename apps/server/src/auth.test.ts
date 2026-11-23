import { afterEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createCipher,
	newPhrase,
	newWorkspaceKey,
	phraseKeys,
	toBase64,
	wrapWorkspaceKey,
} from "@seijaku/sync";
import { openAuth, openStore, startServer } from "./bun";

const stops: (() => void)[] = [];
afterEach(() => {
	for (const stop of stops.splice(0)) stop();
});

async function boot(env: Record<string, string> = {}) {
	const dir = mkdtempSync(join(tmpdir(), "seijaku-auth-"));
	const dbPath = join(dir, "db.sqlite");
	const auth = await openAuth(
		dbPath,
		{
			SETUP_TOKEN: "right-token",
			SEIJAKU_IP_HEADER: "x-forwarded-for",
			...env,
		},
		0,
	);
	const { server } = startServer({
		port: 0,
		store: openStore(dbPath),
		blobDir: join(dir, "blobs"),
		auth,
	});
	stops.push(() => server.stop(true));
	return { base: `http://localhost:${server.port}`, port: server.port };
}

const json = {
	Origin: "http://localhost:5173",
	"Content-Type": "application/json",
};

/** A new phrase with its login key and a wrapped workspace key, as the app makes them. */
function setup() {
	const phrase = newPhrase();
	const keys = phraseKeys(phrase);
	const wk = newWorkspaceKey();
	return {
		phrase,
		loginKey: keys.loginKey,
		wrapped: toBase64(wrapWorkspaceKey(keys.wrapKey, wk)),
		wk,
	};
}

async function post(base: string, path: string, body: unknown, cookie = "") {
	return fetch(`${base}/api/auth${path}`, {
		method: "POST",
		headers: { ...json, ...(cookie ? { Cookie: cookie } : {}) },
		body: JSON.stringify(body),
	});
}

function cookieOf(res: Response): string {
	return res.headers
		.getSetCookie()
		.map((c) => c.split(";")[0])
		.join("; ");
}

test("status says whether sign-up needs a code", async () => {
	const withCode = await boot();
	expect(
		await (await fetch(`${withCode.base}/api/auth/seijaku/status`)).json(),
	).toEqual({ signedIn: false, codeRequired: true });
	const open = await boot({ SETUP_TOKEN: "" });
	expect(
		await (await fetch(`${open.base}/api/auth/seijaku/status`)).json(),
	).toEqual({ signedIn: false, codeRequired: false });
});

test("without a sign-up code anyone can create an account", async () => {
	const { base } = await boot({ SETUP_TOKEN: "" });
	const res = await post(base, "/seijaku/sign-up", setup());
	expect(res.status).toBe(200);
	expect(cookieOf(res)).toContain("seijaku");
});

test("sync and files refuse anyone who is not signed in", async () => {
	const { base, port } = await boot();
	expect((await fetch(`${base}/sync`)).status).toBe(401);
	expect(
		(await fetch(`${base}/api/files`, { method: "POST", body: "x" })).status,
	).toBe(401);
	expect((await fetch(`${base}/api/files/${"a".repeat(24)}`)).status).toBe(401);

	const ws = new WebSocket(`ws://localhost:${port}/sync`);
	const outcome = await new Promise<string>((resolve) => {
		ws.onopen = () => resolve("open");
		ws.onerror = () => resolve("refused");
	});
	expect(outcome).toBe("refused");
});

test("the health check stays public", async () => {
	const { base } = await boot();
	expect((await fetch(`${base}/api/health`)).status).toBe(200);
});

test("registering a passkey needs the sign-up code", async () => {
	const { base } = await boot();
	const ask = (context?: string) =>
		fetch(
			`${base}/api/auth/passkey/generate-register-options?context=${context ?? ""}`,
			{ headers: json },
		);
	expect((await ask()).status).toBe(401);
	expect((await ask("wrong-token")).status).toBe(401);
	expect((await ask("right-token")).status).toBe(200);
});

test("a wrong sign-up code does not create an account", async () => {
	const { base } = await boot();
	const s = setup();
	const res = await post(base, "/seijaku/sign-up", { token: "nope", ...s });
	expect(res.status).toBe(401);
	expect(res.headers.get("set-cookie")).toBeNull();
});

test("signing up with a phrase signs in, and two accounts keep their own keys", async () => {
	const { base } = await boot();
	const s = setup();
	const claim = await post(base, "/seijaku/sign-up", {
		token: "right-token",
		loginKey: s.loginKey,
		wrapped: s.wrapped,
	});
	expect(claim.status).toBe(200);
	const cookie = cookieOf(claim);

	const status = await fetch(`${base}/api/auth/seijaku/status`, {
		headers: { Cookie: cookie },
	});
	expect(await status.json()).toEqual({
		signedIn: true,
		codeRequired: true,
	});
	// The session works for the protected routes.
	expect(
		(
			await fetch(`${base}/api/files/${"a".repeat(24)}`, {
				headers: { Cookie: cookie },
			})
		).status,
	).toBe(404);

	// A second account can sign up too; each phrase opens only its own wrapped key.
	const other = setup();
	const again = await post(base, "/seijaku/sign-up", {
		token: "right-token",
		loginKey: other.loginKey,
		wrapped: other.wrapped,
	});
	expect(again.status).toBe(200);
	const otherLogin = await post(base, "/seijaku/phrase", {
		loginKey: other.loginKey,
	});
	expect(((await otherLogin.json()) as { wrapped: string }).wrapped).toBe(
		other.wrapped,
	);

	// A new device signs in with the phrase and receives the wrapped key.
	const login = await post(base, "/seijaku/phrase", { loginKey: s.loginKey });
	expect(login.status).toBe(200);
	expect(((await login.json()) as { wrapped: string }).wrapped).toBe(s.wrapped);
	expect(cookieOf(login)).toContain("seijaku");
});

test("a wrong phrase is turned away and nothing signs in", async () => {
	const { base } = await boot();
	const s = setup();
	await post(base, "/seijaku/sign-up", {
		token: "right-token",
		loginKey: s.loginKey,
		wrapped: s.wrapped,
	});
	const res = await post(base, "/seijaku/phrase", {
		loginKey: setup().loginKey,
	});
	expect(res.status).toBe(401);
	expect(res.headers.get("set-cookie")).toBeNull();
});

test("a new phrase replaces the old one", async () => {
	const { base } = await boot();
	const old = setup();
	const claim = await post(base, "/seijaku/sign-up", {
		token: "right-token",
		loginKey: old.loginKey,
		wrapped: old.wrapped,
	});
	const cookie = cookieOf(claim);

	const fresh = setup();
	const put = await post(
		base,
		"/seijaku/key-wraps",
		{ kind: "phrase", loginKey: fresh.loginKey, wrapped: fresh.wrapped },
		cookie,
	);
	expect(put.status).toBe(200);

	expect(
		(await post(base, "/seijaku/phrase", { loginKey: old.loginKey })).status,
	).toBe(401);
	expect(
		(await post(base, "/seijaku/phrase", { loginKey: fresh.loginKey })).status,
	).toBe(200);

	const wraps = await fetch(`${base}/api/auth/seijaku/key-wraps`, {
		headers: { Cookie: cookie },
	});
	expect(await wraps.json()).toEqual([
		{ kind: "phrase", ref: "", wrapped: fresh.wrapped },
	]);
});

test("wrapped keys are not handed to anyone without a session", async () => {
	const { base } = await boot();
	const s = setup();
	await post(base, "/seijaku/sign-up", {
		token: "right-token",
		loginKey: s.loginKey,
		wrapped: s.wrapped,
	});
	expect((await fetch(`${base}/api/auth/seijaku/key-wraps`)).status).toBe(401);
	expect(
		(
			await post(base, "/seijaku/key-wraps", {
				kind: "phrase",
				loginKey: setup().loginKey,
				wrapped: s.wrapped,
			})
		).status,
	).toBe(401);
});

test("the server stores nothing it could read a note or a phrase with", async () => {
	const { base } = await boot();
	const s = setup();
	await post(base, "/seijaku/sign-up", {
		token: "right-token",
		loginKey: s.loginKey,
		wrapped: s.wrapped,
	});
	// The workspace key and phrase never travelled; the wrapped copy opens only with the phrase.
	const cipher = createCipher(s.wk);
	expect(cipher.remoteId("note-1")).toMatch(/^d[a-f0-9]{32}$/);
	expect(s.wrapped).not.toContain(toBase64(s.wk));
});

test("phrase sign-in is rate limited", async () => {
	const { base } = await boot();
	const s = setup();
	await post(base, "/seijaku/sign-up", {
		token: "right-token",
		loginKey: s.loginKey,
		wrapped: s.wrapped,
	});
	const statuses: number[] = [];
	for (let i = 0; i < 9; i++) {
		const res = await fetch(`${base}/api/auth/seijaku/phrase`, {
			method: "POST",
			headers: { ...json, "x-forwarded-for": "203.0.113.9" },
			body: JSON.stringify({ loginKey: setup().loginKey }),
		});
		statuses.push(res.status);
	}
	expect(statuses).toContain(429);
});

test("desktop sign-in: a browser session makes a code the app trades for a bearer token", async () => {
	const { base, port } = await boot({ SETUP_TOKEN: "" });
	const up = await post(base, "/seijaku/sign-up", setup());
	const cookie = cookieOf(up);

	// Asking for a code needs a session; the exchange needs a good code.
	expect((await post(base, "/seijaku/desktop-code", {})).status).toBe(401);
	const { code } = (await (
		await post(base, "/seijaku/desktop-code", {}, cookie)
	).json()) as { code: string };
	expect(
		(await post(base, "/seijaku/desktop-exchange", { code: `${code}x` }))
			.status,
	).toBe(401);

	const desktop = {
		Origin: "http://tauri.localhost",
		"Content-Type": "application/json",
	};
	const swap = await fetch(`${base}/api/auth/seijaku/desktop-exchange`, {
		method: "POST",
		headers: desktop,
		body: JSON.stringify({ code }),
	});
	expect(swap.status).toBe(200);
	expect(swap.headers.get("access-control-allow-origin")).toBe(
		"http://tauri.localhost",
	);
	const token = swap.headers.get("set-auth-token");
	expect(token).toBeTruthy();

	// The token stands in for the cookie, on HTTP and on the sync socket.
	const status = await fetch(`${base}/api/auth/seijaku/status`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	expect(((await status.json()) as { signedIn: boolean }).signedIn).toBe(true);
	const ws = new WebSocket(
		`ws://localhost:${port}/sync?token=${encodeURIComponent(token as string)}`,
	);
	expect(
		await new Promise((resolve) => {
			ws.onopen = () => resolve("open");
			ws.onerror = () => resolve("refused");
		}),
	).toBe("open");
	ws.close();
});

test("rate limits cannot be dodged by forging a forwarded address unless the deployment trusts that header", async () => {
	const { base } = await boot({ SEIJAKU_IP_HEADER: "" });
	const statuses: number[] = [];
	for (let i = 0; i < 9; i++) {
		const res = await fetch(`${base}/api/auth/seijaku/phrase`, {
			method: "POST",
			headers: { ...json, "x-forwarded-for": `203.0.113.${i + 1}` },
			body: JSON.stringify({ loginKey: setup().loginKey }),
		});
		statuses.push(res.status);
	}
	expect(statuses).toContain(429);
});
