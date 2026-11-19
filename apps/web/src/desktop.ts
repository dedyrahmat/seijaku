import { authStore } from "./auth/session";
import {
	getDeviceToken,
	savedServerUrl,
	setDeviceToken,
} from "./workspace/syncUrl";

/** True inside the Tauri shell (apps/desktop), false in a browser or the installed PWA. */
export const isDesktop = "__TAURI_INTERNALS__" in window;

/** The small window the capture hotkey opens: same app, loaded at /capture. */
export const isCaptureWindow =
	isDesktop &&
	(
		window as unknown as {
			__TAURI_INTERNALS__: {
				metadata?: { currentWindow?: { label?: string } };
			};
		}
	).__TAURI_INTERNALS__.metadata?.currentWindow?.label === "capture";

async function invoke<T>(cmd: string, args?: Record<string, unknown>) {
	const { invoke } = await import("@tauri-apps/api/core");
	return invoke<T>(cmd, args);
}

/**
 * The desktop app talks to the server from its own origin, so cookies do not travel. It signs
 * in with a bearer token instead: kept in the OS keychain, added to every request to the
 * server, and picked up from the `set-auth-token` header whenever a sign-in creates a session.
 */
function bearerFetch(): void {
	const plain = window.fetch.bind(window);
	window.fetch = async (input, init) => {
		const server = savedServerUrl();
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url;
		if (!server || !url.startsWith(server)) return plain(input, init);
		const headers = new Headers(
			init?.headers ?? (input instanceof Request ? input.headers : undefined),
		);
		const token = getDeviceToken();
		if (token) headers.set("Authorization", `Bearer ${token}`);
		const res = await plain(input, { ...init, headers, credentials: "omit" });
		const fresh = res.headers.get("set-auth-token");
		if (fresh && fresh !== token) {
			setDeviceToken(fresh);
			void invoke("token_set", { token: fresh });
		}
		return res;
	};
}

/** Trades the one-time code from the browser for this device's own session. */
async function exchange(code: string): Promise<void> {
	const server = savedServerUrl();
	if (!server) return;
	const res = await fetch(`${server}/api/auth/seijaku/desktop-exchange`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ code }),
	});
	if (res.ok) await authStore.changed();
}

/**
 * Runs once before the app renders: loads the token, adds it to requests, and listens for
 * the seijaku://signin?code=... link the browser sends back after sign-in.
 */
export async function initDesktop(onSignedIn: () => void): Promise<void> {
	if (!isDesktop) return;
	setDeviceToken((await invoke<string | null>("token_get")) ?? null);
	bearerFetch();
	// The link event reaches every window; only the main one handles it.
	if (isCaptureWindow) return;
	const { getCurrent, onOpenUrl } = await import(
		"@tauri-apps/plugin-deep-link"
	);
	const handle = async (urls: string[] | null) => {
		for (const raw of urls ?? []) {
			const link = new URL(raw);
			const code =
				link.protocol === "seijaku:" && link.hostname === "signin"
					? link.searchParams.get("code")
					: null;
			if (code) {
				await exchange(code);
				onSignedIn();
			}
		}
	};
	void handle(await getCurrent());
	void onOpenUrl((urls) => void handle(urls));
}

/** Passkeys do not work reliably in a webview, so sign-in happens in the system browser. */
export async function signInInBrowser(): Promise<void> {
	const server = savedServerUrl();
	if (!server) throw new Error("Set the server address first.");
	const { openUrl } = await import("@tauri-apps/plugin-opener");
	await openUrl(`${server}/desktop-link`);
}

/** Forget this device's session (the notes stay). */
export function forgetDeviceToken(): void {
	if (!isDesktop) return;
	setDeviceToken(null);
	void invoke("token_clear");
}

export const captureShortcut = () => invoke<string>("capture_shortcut");
export const setCaptureShortcut = (accelerator: string) =>
	invoke<void>("set_capture_shortcut", { accelerator });

export async function hideThisWindow(): Promise<void> {
	const { getCurrentWindow } = await import("@tauri-apps/api/window");
	await getCurrentWindow().hide();
}

/** Looks for a signed update, installs it, and restarts. Returns the new version, or null. */
export async function updateApp(): Promise<string | null> {
	const { check } = await import("@tauri-apps/plugin-updater");
	const update = await check();
	if (!update) return null;
	await update.downloadAndInstall();
	const { relaunch } = await import("@tauri-apps/plugin-process");
	await relaunch();
	return update.version;
}
