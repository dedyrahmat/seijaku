const SERVER_URL_KEY = "seijaku:server-url";

/**
 * WebSocket address of the sync server. Defaults to the server that served this page;
 * a saved override (the desktop app's "server URL" setting, phase 10) wins.
 */
export function syncUrl(pageOrigin: string, override: string | null): string {
	const base = (override?.trim() || pageOrigin).replace(/\/+$/, "");
	return `${base.replace(/^http/, "ws")}/sync`;
}

/** Address of the server's HTTP API: the page's own origin unless a server URL is saved. */
export function apiUrl(path: string): string {
	let override: string | null = null;
	try {
		override = localStorage.getItem(SERVER_URL_KEY);
	} catch {
		// Storage blocked: same origin.
	}
	const base = override?.trim().replace(/\/+$/, "") ?? "";
	return `${base}${path}`;
}

export function currentSyncUrl(): string {
	let override: string | null = null;
	try {
		override = localStorage.getItem(SERVER_URL_KEY);
	} catch {
		// Storage blocked: use the page's own origin.
	}
	return syncUrl(location.origin, override);
}

/** The saved server address, or "" when the page's own origin is used. */
export function savedServerUrl(): string {
	try {
		return localStorage.getItem(SERVER_URL_KEY) ?? "";
	} catch {
		return "";
	}
}

export function saveServerUrl(url: string): void {
	try {
		const clean = url.trim().replace(/\/+$/, "");
		if (clean) localStorage.setItem(SERVER_URL_KEY, clean);
		else localStorage.removeItem(SERVER_URL_KEY);
	} catch {
		// Storage blocked: the address cannot be remembered.
	}
}
