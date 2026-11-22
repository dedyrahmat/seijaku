/**
 * "Clear cache" (Settings → Data) asks for a reload and leaves a flag; this runs first on the
 * next start, before anything opens the databases, so nothing holds them while they go.
 * The workspace key stays (otherwise the device would be locked out), and so does the account.
 */
export const CLEAR_FLAG = "seijaku:clear-cache";

const KEEP = new Set(["seijaku-keys"]);

function drop(name: string): Promise<void> {
	return new Promise((resolve) => {
		const req = indexedDB.deleteDatabase(name);
		req.onsuccess = req.onerror = req.onblocked = () => resolve();
	});
}

/** Everything this app keeps for offline use, except the workspace key. */
export async function wipeOfflineStorage(): Promise<void> {
	const dbs = (await indexedDB.databases?.()) ?? [];
	await Promise.all(
		dbs
			.map((d) => d.name ?? "")
			.filter((n) => n.startsWith("seijaku") && !KEEP.has(n))
			.map(drop),
	);
	// Our own file caches only: the app's own precache stays, so it still starts offline.
	for (const name of (await globalThis.caches?.keys()) ?? [])
		if (name.startsWith("seijaku-")) await caches.delete(name);
}

try {
	if (localStorage.getItem(CLEAR_FLAG) === "1") {
		localStorage.removeItem(CLEAR_FLAG);
		await wipeOfflineStorage();
	}
} catch {
	// Storage blocked: nothing was asked for, nothing to clear.
}
