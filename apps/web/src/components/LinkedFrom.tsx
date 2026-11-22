import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useNotes } from "../workspace/hooks";
import { useBacklinks } from "../workspace/links";
import { pageLink } from "./pageLink";

/** "Linked from" under a note: the pages that point here, each with the line the link sits in. Hidden when none do. */
export function LinkedFrom({ noteId }: { noteId: string }) {
	const { t } = useTranslation();
	const notes = useNotes();
	const links = useBacklinks(noteId, notes);
	if (links.length === 0) return null;
	return (
		<section
			aria-label={t("wiki.linkedFrom")}
			className="mt-10 border-t border-line pt-3.5"
		>
			<h2 className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-mute uppercase">
				{t("wiki.linkedFrom_count", { count: links.length })}
			</h2>
			{links.map(({ from, text }) => (
				<Link
					key={`${from.id}-${text}`}
					{...pageLink(from.id, from.title)}
					className="block border-b border-line py-2 no-underline hover:bg-hover"
				>
					<b className="font-medium text-ink">
						{from.title || t("common.untitled")}
					</b>
					<span className="block text-[13px] text-mute">{text}</span>
				</Link>
			))}
		</section>
	);
}
