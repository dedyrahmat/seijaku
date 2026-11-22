import { isDailyNoteId } from "@seijaku/sync";
import { useTranslation } from "react-i18next";
import { setPref, usePrefs } from "../preferences";
import { useNotes } from "../workspace/hooks";
import { Listbox } from "./Listbox";

/** Where a quick capture lands: Today, a new quick note, or the end of one chosen page. */
export function CaptureTarget({
	className = "",
	label,
}: {
	className?: string;
	label?: string;
}) {
	const { t } = useTranslation();
	const notes = useNotes();
	const { captureTo } = usePrefs();
	const pages = notes
		.filter((n) => !n.trashed && !isDailyNoteId(n.id) && n.kind !== "journal")
		.sort((a, b) => (a.title || "~").localeCompare(b.title || "~"));
	// A chosen page that is gone (trashed, deleted elsewhere) shows as Today, which is where it lands.
	const known = captureTo.startsWith("page:")
		? pages.some((n) => `page:${n.id}` === captureTo)
		: true;
	return (
		<Listbox
			label={label ?? t("settings.general.captureTo.label")}
			value={known ? captureTo : "today"}
			onChange={(v) => setPref("captureTo", v)}
			options={[
				{ value: "today", label: t("sidebar.today") },
				{ value: "new", label: t("capture.newQuick") },
				...pages.map((n) => ({
					value: `page:${n.id}`,
					label: n.title || t("common.untitled"),
					group: t("capture.page"),
				})),
			]}
			className={`border border-line bg-raised text-ink ${className}`}
		/>
	);
}
