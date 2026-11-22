import {
	buildTree,
	isDailyNoteId,
	type NoteKind,
	type TreeNode,
} from "@seijaku/sync";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { i18n } from "../i18n";
import { useNotes } from "../workspace/hooks";
import { Icon } from "./Icon";
import { NOTE_TYPES as TYPES } from "./noteKinds";
import { useNewPage } from "./useNewPage";

/** Pages in sidebar order, each with how deep it sits, for the Save in list. */
interface Choice {
	id: string | null;
	title: string;
	depth: number;
}

function pageChoices(tree: TreeNode[], depth = 0): Choice[] {
	return tree.flatMap((n) => [
		{ id: n.note.id, title: n.note.title || i18n.t("common.untitled"), depth },
		...pageChoices(n.children, depth + 1),
	]);
}

/**
 * The mockup's New note board: pick what you are writing, where it goes, and go. Keys 1 to 6
 * pick a card, arrows move between them, Enter creates, Esc closes.
 */
export function NewNoteDialog({
	defaultParentId,
	onClose,
}: {
	/** Where Save in starts: the open page's parent, or null for the top level. */
	defaultParentId: string | null;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const notes = useNotes();
	const newPage = useNewPage();
	const [kind, setKind] = useState<NoteKind>("quick");
	const [parentId, setParentId] = useState<string | null>(defaultParentId);
	const [listOpen, setListOpen] = useState(false);
	const cards = useRef<(HTMLInputElement | null)[]>([]);

	const choices = useMemo(
		() => pageChoices(buildTree(notes.filter((n) => !isDailyNoteId(n.id)))),
		[notes],
	);
	const isJournal = kind === "journal";
	const where = isJournal
		? t("newNote.journal")
		: (choices.find((c) => c.id === parentId)?.title ?? t("newNote.topLevel"));

	useEffect(() => {
		cards.current[0]?.focus();
	}, []);

	const create = () => {
		void newPage(isJournal ? null : parentId, kind);
		onClose();
	};

	// The cards are native radios, so arrow keys already move between them.
	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Escape") {
			e.stopPropagation();
			if (listOpen) setListOpen(false);
			else onClose();
			return;
		}
		if (e.metaKey || e.ctrlKey || e.altKey || listOpen) return;
		const onCard = (e.target as HTMLElement).dataset.card !== undefined;
		if (/^[1-6]$/.test(e.key)) {
			const i = Number(e.key) - 1;
			e.preventDefault();
			setKind(TYPES[i]?.id ?? kind);
			cards.current[i]?.focus();
		} else if (e.key === "Enter" && onCard) {
			e.preventDefault();
			create();
		}
	};

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: the scrim only closes on a click; Esc closes from the keyboard
		<div
			className="fixed inset-0 z-50 flex items-end justify-center bg-scrim md:items-center md:p-6"
			onMouseDown={(e) => e.target === e.currentTarget && onClose()}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={t("newNote.title")}
				onKeyDown={onKeyDown}
				className="flex h-[100dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-paper text-ink shadow-[0_30px_80px_rgba(40,30,15,0.28),0_2px_8px_rgba(40,30,15,0.1)] md:h-auto md:max-h-full md:max-w-[840px] md:rounded-2xl"
			>
				<header className="flex items-start justify-between gap-4 px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-5 md:py-7 md:pr-7 md:pl-9">
					<div className="flex flex-col gap-1">
						<h2 className="font-serif text-[30px] leading-[1.1] font-medium tracking-[-0.01em]">
							{t("newNote.heading")}
						</h2>
						<p className="text-sm text-mute">{t("newNote.sub")}</p>
					</div>
					<button
						type="button"
						aria-label={t("common.close")}
						onClick={onClose}
						className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink2 hover:bg-hover md:size-10"
					>
						<Icon name="close" size={18} />
					</button>
				</header>

				<div
					role="radiogroup"
					aria-label={t("newNote.type")}
					className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-3.5 overflow-y-auto px-5 pb-5 md:grid-cols-3 md:px-9"
				>
					{TYPES.map((type, i) => {
						const on = type.id === kind;
						return (
							<label
								key={type.id}
								onDoubleClick={create}
								className={`relative flex min-h-[148px] cursor-pointer flex-col items-start gap-3 rounded-2xl border-[1.5px] p-[18px] text-left has-[:focus-visible]:outline-[1.5px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink/40 ${on ? "border-accent bg-raised" : "border-line2 hover:bg-hover/60"}`}
							>
								<input
									ref={(el) => {
										cards.current[i] = el;
									}}
									type="radio"
									name="note-type"
									data-card
									checked={on}
									onChange={() => setKind(type.id)}
									className="sr-only"
								/>
								<span
									className={`flex size-11 items-center justify-center rounded-full ${on ? "bg-accent-soft text-accent" : "bg-tag text-ink2"}`}
								>
									<svg
										width="22"
										height="22"
										viewBox="0 0 22 22"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.5"
										strokeLinecap="round"
										strokeLinejoin="round"
										aria-hidden="true"
									>
										<path d={type.icon} />
									</svg>
								</span>
								<span className="flex flex-col gap-1">
									<span className="text-[15px] font-semibold">
										{t(`kinds.${type.id}.name`)}
									</span>
									<span className="text-[13px] leading-[1.4] text-mute">
										{t(`kinds.${type.id}.desc`)}
									</span>
								</span>
								<kbd className="absolute top-4 right-4 hidden size-6 items-center justify-center rounded-full border border-line bg-raised font-mono text-[11px] text-mute md:flex">
									{i + 1}
								</kbd>
							</label>
						);
					})}
				</div>

				<footer className="flex flex-wrap items-center gap-3 border-t border-line2 bg-panel px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:mt-6 md:pr-7 md:pl-9">
					<span className="text-[13px] text-mute">{t("newNote.saveIn")}</span>
					<div className="relative">
						<button
							type="button"
							aria-haspopup="true"
							aria-expanded={listOpen}
							aria-label={t("newNote.saveInWhere", { where })}
							disabled={isJournal}
							onClick={() => setListOpen((v) => !v)}
							className="flex h-11 max-w-[220px] items-center gap-2 rounded-full border border-line bg-raised px-3 text-[13px] hover:bg-hover disabled:opacity-60 md:h-9"
						>
							<Icon name="folder" size={16} className="shrink-0 text-mute" />
							<span className="truncate">{where}</span>
							<Icon name="down" size={12} className="shrink-0 text-mute" />
						</button>
						{listOpen ? (
							<div className="absolute bottom-full left-0 z-10 mb-1 max-h-64 w-72 max-w-[80vw] overflow-y-auto rounded-2xl border border-line bg-raised p-1 shadow-lg">
								{[
									{ id: null, title: t("newNote.topLevel"), depth: 0 },
									...choices,
								].map((c) => (
									<button
										key={c.id ?? "top"}
										type="button"
										aria-pressed={c.id === parentId}
										onClick={() => {
											setParentId(c.id);
											setListOpen(false);
										}}
										style={{ paddingLeft: 12 + c.depth * 16 }}
										className={`block min-h-11 w-full truncate rounded-full pr-3 text-left text-sm hover:bg-hover md:min-h-8 ${c.id === parentId ? "bg-hover font-medium" : ""}`}
									>
										{c.title}
									</button>
								))}
							</div>
						) : null}
					</div>
					<div className="flex-1" />
					<span className="hidden text-xs text-mute md:inline">
						{t("newNote.keys")}
					</span>
					<button
						type="button"
						onClick={onClose}
						className="h-11 rounded-full border border-line px-4 text-[13px] font-medium hover:bg-hover md:h-[38px]"
					>
						{t("common.cancel")}
					</button>
					<button
						type="button"
						onClick={create}
						className="h-11 rounded-full bg-ink px-5 text-[13px] font-semibold text-paper md:h-[38px]"
					>
						{t("newNote.create", { kind: t(`kinds.${kind}.short`) })}
					</button>
				</footer>
			</div>
		</div>
	);
}
