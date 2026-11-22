import { createReactInlineContentSpec } from "@blocknote/react";
import { PAGE_LINK } from "@seijaku/sync";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { pageLink } from "../components/pageLink";
import { useNotes } from "../workspace/hooks";

/**
 * A `[[link]]` to another page, stored as the page's id so a rename never breaks it. The words
 * shown are the page's current title; a page in Trash or gone reads muted and dashed.
 */
function PageLinkView({ noteId }: { noteId: string }) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const note = useNotes().find((n) => n.id === noteId);
	const gone = !note || note.trashed;
	const title =
		note?.title || (note ? t("common.untitled") : t("wiki.deleted"));
	return (
		<a
			className={
				gone ? "seijaku-wikilink seijaku-wikilink--gone" : "seijaku-wikilink"
			}
			href={note ? `/page/${noteId}` : undefined}
			title={gone ? (note ? t("wiki.inTrash") : t("wiki.deleted")) : undefined}
			onClick={(e) => {
				e.preventDefault();
				if (note) void navigate(pageLink(note.id, note.title));
			}}
		>
			{title}
		</a>
	);
}

export const PageLink = createReactInlineContentSpec(
	{ type: PAGE_LINK, propSchema: { noteId: { default: "" } }, content: "none" },
	{
		render: ({ inlineContent }) => (
			<PageLinkView noteId={inlineContent.props.noteId} />
		),
	},
);
