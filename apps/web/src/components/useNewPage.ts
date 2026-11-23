import {
	addOption,
	addProp,
	createNote,
	dailyTitle,
	ensureJournalEntry,
	type NoteKind,
} from "@seijaku/sync";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { i18n } from "../i18n";
import { workspace } from "../workspace/store";
import { pageLink, quickLink } from "./pageLink";

/**
 * Returns a function that creates a note (a plain page unless a `kind` is given, optionally under
 * a parent), fills in what that kind starts with, and opens it. A journal entry is today's entry
 * under "Journal": it is opened if it already exists, never made twice.
 */
export function useNewPage(): (
	parentId: string | null,
	kind?: NoteKind,
) => Promise<string> {
	const navigate = useNavigate();
	return useCallback(
		async (parentId, kind = "page") => {
			if (kind === "journal") {
				const today = new Date();
				const id = ensureJournalEntry(workspace.index, today);
				void navigate(pageLink(id, dailyTitle(today)));
				return id;
			}
			const id = createNote(workspace.index, { parentId, kind });
			if (kind === "database") {
				// A Status property and one empty row, so the table is not blank.
				const status = addProp(workspace.index, id, {
					name: i18n.t("db.status"),
					type: "select",
				});
				for (const label of [
					i18n.t("db.todo"),
					i18n.t("db.doing"),
					i18n.t("db.done"),
				])
					addOption(workspace.index, id, status, label);
				createNote(workspace.index, { parentId: id });
			}
			if (kind === "checklist" || kind === "meeting" || kind === "study") {
				// Loaded on demand: the templates pull in the editor, which the sidebar should not.
				// Written before the page opens, so the editor loads it instead of racing it.
				const { applyTemplate } = await import("../editor/templates");
				await applyTemplate(id, kind);
			}
			void navigate(kind === "quick" ? quickLink(id, "") : pageLink(id, ""));
			return id;
		},
		[navigate],
	);
}
