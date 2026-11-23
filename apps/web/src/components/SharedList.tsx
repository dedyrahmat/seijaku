import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useCollab, useNotes } from "../workspace/hooks";
import { pageLink } from "./pageLink";

/** "Shared with me" and "Shared by me" in the sidebar. Hidden while there is nothing to show. */
export function SharedList() {
	const { t } = useTranslation();
	const entries = useCollab();
	const notes = useNotes();
	const mine = entries.filter(([, e]) => e.owner && !e.ended);
	const theirs = entries.filter(([, e]) => !e.owner);
	if (!mine.length && !theirs.length) return null;
	const row =
		"flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-ink hover:bg-hover";
	const head =
		"px-2.5 pt-[18px] pb-1.5 text-[11px] font-medium tracking-[0.09em] text-mute uppercase";
	return (
		<>
			{theirs.length ? (
				<div>
					<div className={head}>{t("collab.sharedWithMe")}</div>
					{theirs.map(([id, e]) => (
						<Link key={id} to="/shared/$id" params={{ id }} className={row}>
							<span className="min-w-0 flex-1 truncate">
								{e.title || t("collab.sharedPage")}
							</span>
							<span className="text-xs text-mute">
								{e.ended ? t("collab.ended") : t(`collab.role.${e.role}`)}
							</span>
						</Link>
					))}
				</div>
			) : null}
			{mine.length ? (
				<div>
					<div className={head}>{t("collab.sharedByMe")}</div>
					{mine.map(([id, e]) => {
						const note = notes.find((n) => n.id === e.noteId);
						if (!note) return null;
						return (
							<Link key={id} {...pageLink(note.id, note.title)} className={row}>
								<span className="min-w-0 flex-1 truncate">
									{note.title || t("common.untitled")}
								</span>
								{e.rotating ? (
									<span className="text-xs text-mute">
										{t("collab.finishing")}
									</span>
								) : null}
							</Link>
						);
					})}
				</div>
			) : null}
		</>
	);
}
