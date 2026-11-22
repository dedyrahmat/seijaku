import { dailyTitle, ensureDailyNote, getNote } from "@seijaku/sync";
import { pageLink, quickLink } from "./components/pageLink";
import { LAST_NOTE_KEY } from "./pages/Home";
import { getPrefs } from "./preferences";
import type { router as Router } from "./router";
import { readLocal } from "./workspace/hooks";
import { workspace } from "./workspace/store";

/** "Open on start": once, when the app opens at its root, go where the person asked to land. */
export async function openStartPage(router: typeof Router): Promise<void> {
	if (router.state.location.pathname !== "/") return;
	const where = getPrefs().openOnStart;
	if (where === "Home") return;
	await workspace.ready;
	// The person may have clicked somewhere while the workspace loaded.
	if (router.state.location.pathname !== "/") return;
	if (where === "Today") {
		const today = new Date();
		const id = ensureDailyNote(workspace.index, today);
		await router.navigate({
			...pageLink(id, dailyTitle(today)),
			replace: true,
		});
		return;
	}
	const id = readLocal(LAST_NOTE_KEY);
	const note = id ? getNote(workspace.index, id) : undefined;
	if (!note || note.trashed) return;
	await router.navigate({
		...(note.kind === "quick"
			? quickLink(note.id, note.title)
			: pageLink(note.id, note.title)),
		replace: true,
	});
}
