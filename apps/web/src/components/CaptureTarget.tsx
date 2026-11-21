import { isDailyNoteId } from "@seijaku/sync";
import { setPref, usePrefs } from "../preferences";
import { useNotes } from "../workspace/hooks";

/** Where a quick capture lands: Today, a new quick note, or the end of one chosen page. */
export function CaptureTarget({
	className = "",
	label = "Add captures to",
}: {
	className?: string;
	label?: string;
}) {
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
		<select
			aria-label={label}
			value={known ? captureTo : "today"}
			onChange={(e) => setPref("captureTo", e.target.value)}
			className={`cursor-pointer appearance-none rounded-2xl border border-line bg-raised text-ink ${className}`}
		>
			<option value="today">Today</option>
			<option value="new">A new quick note</option>
			{pages.length > 0 ? (
				<optgroup label="A page">
					{pages.map((n) => (
						<option key={n.id} value={`page:${n.id}`}>
							{n.title || "Untitled"}
						</option>
					))}
				</optgroup>
			) : null}
		</select>
	);
}
