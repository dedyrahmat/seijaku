import { type NoteMeta, normalizeTag, updateNote } from "@seijaku/sync";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { workspace } from "../workspace/store";
import { ago } from "./ago";

/** Under the title: #tags as quiet pills, then when the page was last edited (from the design). */
export function NoteMetaRow({ note }: { note: NoteMeta }) {
	const { t } = useTranslation();
	const [adding, setAdding] = useState(false);
	const [draft, setDraft] = useState("");
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		const t = setInterval(() => setNow(Date.now()), 30_000);
		return () => clearInterval(t);
	}, []);

	const setTags = (tags: string[]) =>
		updateNote(workspace.index, note.id, { tags });

	const commit = () => {
		const tag = normalizeTag(draft);
		if (tag && !note.tags.includes(tag)) setTags([...note.tags, tag]);
		setDraft("");
		setAdding(false);
	};

	return (
		<div className="-mt-1 mb-5 flex flex-wrap items-center gap-x-2.5 gap-y-2 text-[13px] text-mute">
			{note.tags.map((tag) => (
				<span
					key={tag}
					className="group flex items-center rounded-full bg-tag py-0.5 pr-2.5 pl-2.5 text-ink2"
				>
					#{tag}
					<button
						type="button"
						aria-label={t("meta.removeTag", { tag })}
						onClick={() => setTags(note.tags.filter((t) => t !== tag))}
						className="ml-0 w-0 overflow-hidden text-mute opacity-0 transition-all group-focus-within:ml-1.5 group-focus-within:w-3 group-focus-within:opacity-100 group-hover:ml-1.5 group-hover:w-3 group-hover:opacity-100 hover:text-ink"
					>
						×
					</button>
				</span>
			))}
			{adding ? (
				<input
					// biome-ignore lint/a11y/noAutofocus: the user just asked to add a tag
					autoFocus
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					onBlur={commit}
					onKeyDown={(e) => {
						// keyCode 229: Safari reports the IME-confirming Enter after isComposing resets
						if (
							e.key === "Enter" &&
							!e.nativeEvent.isComposing &&
							e.keyCode !== 229
						)
							commit();
						if (e.key === "Escape") {
							setDraft("");
							setAdding(false);
						}
					}}
					aria-label={t("meta.newTag")}
					placeholder={t("meta.tagPlaceholder")}
					className="h-6 w-24 rounded-full bg-tag px-2.5 text-ink2 outline-none placeholder:text-mute"
				/>
			) : (
				<button
					type="button"
					onClick={() => setAdding(true)}
					className="rounded-full px-1 py-0.5 hover:text-ink"
				>
					{note.tags.length === 0 ? "+ Add a tag" : "+"}
				</button>
			)}
			<span aria-hidden>·</span>
			<span>{t("meta.edited", { when: ago(note.updatedAt, now) })}</span>
		</div>
	);
}
