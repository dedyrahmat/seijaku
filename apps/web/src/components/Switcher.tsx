import {
	createNote,
	dailyTitle,
	isDailyNoteId,
	type NoteMeta,
	searchNotes,
} from "@seijaku/sync";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNotes } from "../workspace/hooks";
import { workspace } from "../workspace/store";
import { pageLink } from "./pageLink";

/** Body text per note, kept for the session and refreshed when a note's edit time changes. */
const textCache = new Map<string, { stamp: number; text: string }>();

/** Loads the text of every note in the background so search can see inside them. */
function useNoteTexts(notes: NoteMeta[], active: boolean) {
	const [version, bump] = useState(0);
	useEffect(() => {
		if (!active) return;
		let live = true;
		(async () => {
			let sinceBump = 0;
			for (const n of notes) {
				if (!live) return;
				if (n.trashed || textCache.get(n.id)?.stamp === n.updatedAt) continue;
				const text = await workspace.readText(n.id).catch(() => "");
				textCache.set(n.id, { stamp: n.updatedAt, text });
				if (++sinceBump % 8 === 0) bump((v) => v + 1);
			}
			if (live) bump((v) => v + 1);
		})();
		return () => {
			live = false;
		};
	}, [notes, active]);
	return { version, textOf: (id: string) => textCache.get(id)?.text };
}

function where(note: NoteMeta, notes: NoteMeta[]): string {
	if (isDailyNoteId(note.id)) return "Daily note";
	return notes.find((n) => n.id === note.parentId)?.title || "";
}

export function Switcher({
	open,
	initialQuery,
	onClose,
}: {
	open: boolean;
	initialQuery: string;
	onClose: () => void;
}) {
	if (!open) return null;
	return <SwitcherDialog initialQuery={initialQuery} onClose={onClose} />;
}

function SwitcherDialog({
	initialQuery,
	onClose,
}: {
	initialQuery: string;
	onClose: () => void;
}) {
	const notes = useNotes();
	const navigate = useNavigate();
	const { version, textOf } = useNoteTexts(notes, true);
	const [query, setQuery] = useState(initialQuery);
	const [cursor, setCursor] = useState(0);
	const input = useRef<HTMLInputElement>(null);
	const list = useRef<HTMLDivElement>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: version marks new body text arriving in the cache
	const hits = useMemo(
		() => searchNotes(notes, textOf, query),
		[notes, query, version],
	);
	const trimmed = query.trim();
	const canCreate = trimmed !== "" && !trimmed.startsWith("#");
	const rowCount = hits.length + (canCreate ? 1 : 0);

	// biome-ignore lint/correctness/useExhaustiveDependencies: restart at the top whenever the query changes
	useEffect(() => setCursor(0), [query]);
	useEffect(() => {
		input.current?.focus();
		input.current?.select();
	}, []);
	// biome-ignore lint/correctness/useExhaustiveDependencies: cursor moves the highlighted row, which this scrolls into view
	useEffect(() => {
		list.current
			?.querySelector('[aria-selected="true"]')
			?.scrollIntoView({ block: "nearest" });
	}, [cursor]);

	const openNote = (n: NoteMeta) => {
		void navigate(pageLink(n.id, n.title));
		onClose();
	};
	const create = () => {
		const id = createNote(workspace.index, { title: trimmed });
		void navigate(pageLink(id, trimmed));
		onClose();
	};
	const choose = (i: number) => {
		const hit = hits[i];
		if (hit) openNote(hit.note);
		else if (canCreate) create();
	};

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Escape") {
			e.preventDefault();
			onClose();
		} else if (e.key === "ArrowDown") {
			e.preventDefault();
			setCursor((c) => (rowCount ? (c + 1) % rowCount : 0));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setCursor((c) => (rowCount ? (c - 1 + rowCount) % rowCount : 0));
		} else if (e.key === "Enter") {
			e.preventDefault();
			choose(cursor);
		}
	};

	const label = (n: NoteMeta) =>
		n.title || (isDailyNoteId(n.id) ? dailyTitle(new Date()) : "Untitled");

	return (
		<div className="fixed inset-0 z-[60]">
			<button
				type="button"
				aria-label="Close search"
				tabIndex={-1}
				onClick={onClose}
				className="absolute inset-0 bg-scrim"
			/>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: key handling for the dialog's own input */}
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Search and jump"
				onKeyDown={onKeyDown}
				className="absolute inset-x-3 top-[max(12px,env(safe-area-inset-top))] mx-auto flex max-h-[calc(100dvh-24px)] max-w-[640px] flex-col overflow-hidden rounded-2xl border border-line bg-raised shadow-[0_24px_60px_rgba(40,30,15,0.22),0_2px_8px_rgba(40,30,15,0.1)] md:top-[112px] md:max-h-[calc(100dvh-160px)]"
			>
				<div className="flex h-[60px] flex-none items-center gap-3 border-b border-line2 px-[18px]">
					<svg
						width="18"
						height="18"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.4"
						strokeLinecap="round"
						className="text-ink2"
						aria-hidden="true"
					>
						<circle cx="7" cy="7" r="4.5" />
						<path d="M10.5 10.5L14 14" />
					</svg>
					<input
						ref={input}
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						aria-label="Search"
						placeholder="Search or jump to"
						autoComplete="off"
						spellCheck={false}
						className="min-w-0 flex-1 bg-transparent text-lg text-ink outline-none placeholder:text-mute"
					/>
					<kbd className="rounded-2xl border border-line px-1.5 py-0.5 font-mono text-[11px] text-mute">
						Esc
					</kbd>
				</div>

				<div
					ref={list}
					className="min-h-0 flex-1 overflow-y-auto px-2 pt-2.5 pb-1.5"
				>
					<div className="px-3 py-1.5 text-[11px] font-medium tracking-[0.09em] text-mute uppercase">
						{trimmed ? "Notes" : "Recent"}
					</div>
					{hits.length === 0 ? (
						<p className="px-3 py-2 text-sm text-mute">
							{trimmed ? "Nothing matches yet." : "No pages yet."}
						</p>
					) : (
						hits.map((hit, i) => (
							<button
								type="button"
								key={hit.note.id}
								role="option"
								aria-selected={i === cursor}
								onMouseMove={() => setCursor(i)}
								onClick={() => openNote(hit.note)}
								className={`flex w-full flex-col gap-[3px] rounded-2xl px-3 py-2.5 text-left ${i === cursor ? "bg-hover" : ""}`}
							>
								<span className="flex items-baseline gap-2.5">
									<span className="truncate text-[15px] font-medium text-ink">
										{label(hit.note)}
									</span>
									<span className="shrink-0 text-xs text-mute">
										{where(hit.note, notes)}
									</span>
								</span>
								{hit.snippet ? (
									<span className="line-clamp-2 text-[13px] leading-normal text-ink2">
										{hit.snippet.before}
										<mark className="rounded-2xl bg-mark px-0.5 text-inherit">
											{hit.snippet.match}
										</mark>
										{hit.snippet.after}
									</span>
								) : null}
							</button>
						))
					)}

					{canCreate ? (
						<>
							<div className="px-3 pt-3 pb-1.5 text-[11px] font-medium tracking-[0.09em] text-mute uppercase">
								Actions
							</div>
							<button
								type="button"
								role="option"
								aria-selected={cursor === hits.length}
								onMouseMove={() => setCursor(hits.length)}
								onClick={create}
								className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm ${cursor === hits.length ? "bg-hover" : ""}`}
							>
								<svg
									width="16"
									height="16"
									viewBox="0 0 16 16"
									fill="none"
									stroke="currentColor"
									strokeWidth="1.4"
									strokeLinecap="round"
									className="text-ink2"
									aria-hidden="true"
								>
									<path d="M8 3v10M3 8h10" />
								</svg>
								<span className="truncate">
									Create a page called “{trimmed}”
								</span>
							</button>
						</>
					) : null}
				</div>

				<div className="flex flex-none gap-[18px] border-t border-line2 px-[18px] py-2.5 text-xs text-mute">
					<span>↑ ↓ move</span>
					<span>Enter open</span>
					<span className="ml-auto">
						{trimmed
							? `${hits.length} ${hits.length === 1 ? "match" : "matches"} · searched on this device`
							: "searched on this device"}
					</span>
				</div>
			</div>
		</div>
	);
}
