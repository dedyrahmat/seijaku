import { useTranslation } from "react-i18next";
import "@blocknote/core/fonts/inter.css";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import "@blocknote/mantine/style.css";
import "katex/dist/katex.min.css";
import type { Block } from "../editor/headless";
import { schema } from "../editor/schema";
import { useColorScheme } from "../theme";
import { resolveFileUrl } from "../workspace/files";

/** A note drawn as the editor draws it, but not editable: history previews and shared pages. */
export function ReadOnlyNote({
	title,
	blocks,
}: {
	title: string;
	blocks: Block[];
}) {
	const { t } = useTranslation();
	const scheme = useColorScheme();
	const editor = useCreateBlockNote(
		{
			schema, // BlockNote refuses an empty list (a page with nothing on it yet).
			initialContent: blocks.length > 0 ? (blocks as never) : undefined,
			resolveFileUrl,
		},
		[blocks],
	);
	return (
		<article className="mx-auto w-full max-w-[var(--page-width,760px)] px-5 pt-10 pb-24 md:pt-[72px]">
			<h1 className="mb-4 font-serif text-[42px] leading-[1.12] font-medium tracking-[-0.015em] text-ink md:text-[68px]">
				{title || t("common.untitled")}
			</h1>
			<BlockNoteView editor={editor} theme={scheme} editable={false} />
		</article>
	);
}
