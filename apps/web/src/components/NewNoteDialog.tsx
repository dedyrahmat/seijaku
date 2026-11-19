import {
	buildTree,
	isDailyNoteId,
	type NoteKind,
	type TreeNode,
} from "@seijaku/sync";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNotes } from "../workspace/hooks";
import { useNewPage } from "./useNewPage";

/** The six shapes on the mockup's "New note" board, with its icons and copy. */
const TYPES: {
	id: NoteKind;
	name: string;
	short: string;
	desc: string;
	icon: string;
}[] = [
	{
		id: "quick",
		name: "Quick note",
		short: "quick note",
		desc: "A sticky note. One thought, a number, a name. Saved the moment you stop typing.",
		icon: "M4 4h14v9l-5 5H4zM18 13h-5v5",
	},
	{
		id: "page",
		name: "Page",
		short: "page",
		desc: "A blank page with a title. Headings, lists, images, anything.",
		icon: "M6 3h7l4 4v12H6zM13 3v4h4M9 11h5M9 14.5h5",
	},
	{
		id: "checklist",
		name: "Checklist",
		short: "checklist",
		desc: "To-dos you can tick off. Unfinished ones show up in Today.",
		icon: "M4 6l1.6 1.6L8.4 4.8M11.5 6.2H18M4 12l1.6 1.6 2.8-2.8M11.5 12.2H18M4.4 17.6h3.4M11.5 17.6H18",
	},
	{
		id: "journal",
		name: "Journal entry",
		short: "journal entry",
		desc: "Dated for today and filed under Journal. One per day, picked up where you left it.",
		icon: "M5 4h11a1 1 0 0 1 1 1v13H6a1 1 0 0 1-1-1zM8 4v14M11 8.5h3.5M11 11.5h3.5",
	},
	{
		id: "meeting",
		name: "Meeting notes",
		short: "meeting notes",
		desc: "Who was there, what was said, and what happens next.",
		icon: "M8 10a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2zM3.5 17.5c0-2.5 2-4.3 4.5-4.3s4.5 1.8 4.5 4.3M14.5 9.6a2.2 2.2 0 1 0 0-4.4M15 13.3c2 .3 3.5 1.9 3.5 4.2",
	},
	{
		id: "study",
		name: "Study note",
		short: "study note",
		desc: "A summary callout up top, then room for maths, code and questions to revisit.",
		icon: "M3 7.5L11 4l8 3.5-8 3.5zM6.5 9.4V14c1.2 1.3 2.8 2 4.5 2s3.3-.7 4.5-2V9.4M19 7.5V12",
	},
];

const folderIcon =
	"M2 4.5a1 1 0 0 1 1-1h3.2l1.4 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z";

/** Pages in sidebar order, each with how deep it sits, for the "Save in" list. */
interface Choice {
	id: string | null;
	title: string;
	depth: number;
}

function pageChoices(tree: TreeNode[], depth = 0): Choice[] {
	return tree.flatMap((n) => [
		{ id: n.note.id, title: n.note.title || "Untitled", depth },
		...pageChoices(n.children, depth + 1),
	]);
}

/**
 * The mockup's "New note" board: pick what you are writing, where it goes, and go. Keys 1 to 6
 * pick a card, arrows move between them, Enter creates, Esc closes.
 */
export function NewNoteDialog({
	defaultParentId,
	onClose,
}: {
	/** Where "Save in" starts: the open page's parent, or null for the top level. */
	defaultParentId: string | null;
	onClose: () => void;
}) {
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
	const chosen = TYPES.find((t) => t.id === kind) ?? TYPES[0];
	const isJournal = kind === "journal";
	const where = isJournal
		? "Journal"
		: (choices.find((c) => c.id === parentId)?.title ?? "Top level");

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
				aria-label="New note"
				onKeyDown={onKeyDown}
				className="flex h-[100dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-paper text-ink shadow-[0_30px_80px_rgba(40,30,15,0.28),0_2px_8px_rgba(40,30,15,0.1)] md:h-auto md:max-h-full md:max-w-[840px] md:rounded-2xl"
			>
				<header className="flex items-start justify-between gap-4 px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-5 md:py-7 md:pr-7 md:pl-9">
					<div className="flex flex-col gap-1">
						<h2 className="font-serif text-[30px] leading-[1.1] font-medium tracking-[-0.01em]">
							What are you writing?
						</h2>
						<p className="text-sm text-mute">
							Pick a shape for the note. You can change it later.
						</p>
					</div>
					<button
						type="button"
						aria-label="Close"
						onClick={onClose}
						className="flex size-11 shrink-0 items-center justify-center rounded-2xl text-ink2 hover:bg-hover md:size-10"
					>
						<svg
							width="18"
							height="18"
							viewBox="0 0 18 18"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.6"
							strokeLinecap="round"
							aria-hidden="true"
						>
							<path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />
						</svg>
					</button>
				</header>

				<div
					role="radiogroup"
					aria-label="Note type"
					className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-3.5 overflow-y-auto px-5 pb-5 md:grid-cols-3 md:px-9"
				>
					{TYPES.map((t, i) => {
						const on = t.id === kind;
						return (
							// biome-ignore lint/a11y/noLabelWithoutControl: the radio input is inside the label
							<label
								key={t.id}
								onDoubleClick={create}
								className={`relative flex min-h-[148px] cursor-pointer flex-col items-start gap-3 rounded-2xl border-[1.5px] p-[18px] text-left has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${on ? "border-accent bg-raised" : "border-line2 hover:bg-hover/60"}`}
							>
								<input
									ref={(el) => {
										cards.current[i] = el;
									}}
									type="radio"
									name="note-type"
									data-card
									checked={on}
									onChange={() => setKind(t.id)}
									className="sr-only"
								/>
								<span
									className={`flex size-11 items-center justify-center rounded-2xl ${on ? "bg-accent-soft text-accent" : "bg-tag text-ink2"}`}
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
										<path d={t.icon} />
									</svg>
								</span>
								<span className="flex flex-col gap-1">
									<span className="text-[15px] font-semibold">{t.name}</span>
									<span className="text-[13px] leading-[1.4] text-mute">
										{t.desc}
									</span>
								</span>
								<kbd className="absolute top-4 right-4 hidden size-6 items-center justify-center rounded-lg border border-line bg-raised font-mono text-[11px] text-mute md:flex">
									{i + 1}
								</kbd>
							</label>
						);
					})}
				</div>

				<footer className="flex flex-wrap items-center gap-3 border-t border-line2 bg-panel px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:mt-6 md:pr-7 md:pl-9">
					<span className="text-[13px] text-mute">Save in</span>
					<div className="relative">
						<button
							type="button"
							aria-haspopup="true"
							aria-expanded={listOpen}
							aria-label={`Save in: ${where}`}
							disabled={isJournal}
							onClick={() => setListOpen((v) => !v)}
							className="flex h-11 max-w-[220px] items-center gap-2 rounded-2xl border border-line bg-raised px-3 text-[13px] hover:bg-hover disabled:opacity-60 md:h-9"
						>
							<svg
								width="16"
								height="16"
								viewBox="0 0 16 16"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.3"
								strokeLinecap="round"
								strokeLinejoin="round"
								className="shrink-0 text-mute"
								aria-hidden="true"
							>
								<path d={folderIcon} />
							</svg>
							<span className="truncate">{where}</span>
							<svg
								width="12"
								height="12"
								viewBox="0 0 12 12"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
								strokeLinejoin="round"
								className="shrink-0 text-mute"
								aria-hidden="true"
							>
								<path d="M2.5 4.5L6 8l3.5-3.5" />
							</svg>
						</button>
						{listOpen ? (
							<div className="absolute bottom-full left-0 z-10 mb-1 max-h-64 w-72 max-w-[80vw] overflow-y-auto rounded-2xl border border-line bg-raised p-1 shadow-lg">
								{[{ id: null, title: "Top level", depth: 0 }, ...choices].map(
									(c) => (
										<button
											key={c.id ?? "top"}
											type="button"
											aria-pressed={c.id === parentId}
											onClick={() => {
												setParentId(c.id);
												setListOpen(false);
											}}
											style={{ paddingLeft: 12 + c.depth * 16 }}
											className={`block min-h-11 w-full truncate rounded-2xl pr-3 text-left text-sm hover:bg-hover md:min-h-8 ${c.id === parentId ? "bg-hover font-medium" : ""}`}
										>
											{c.title}
										</button>
									),
								)}
							</div>
						) : null}
					</div>
					<div className="flex-1" />
					<span className="hidden text-xs text-mute md:inline">
						Press 1 to 6, or Enter
					</span>
					<button
						type="button"
						onClick={onClose}
						className="h-11 rounded-2xl border border-line px-4 text-[13px] font-medium hover:bg-hover md:h-[38px]"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={create}
						className="h-11 rounded-2xl bg-ink px-5 text-[13px] font-semibold text-paper md:h-[38px]"
					>
						Create {chosen?.short}
					</button>
				</footer>
			</div>
		</div>
	);
}
