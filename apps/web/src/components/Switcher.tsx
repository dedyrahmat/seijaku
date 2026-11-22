import {
	createNote,
	dailyTitle,
	isDailyNoteId,
	type NoteKind,
	type NoteMeta,
	searchNotes,
} from "@seijaku/sync";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { dateLocale, i18n } from "../i18n";
import { useNotes } from "../workspace/hooks";
import { workspace } from "../workspace/store";
import { Icon } from "./Icon";
import { KindGlyph, NOTE_TYPES } from "./noteKinds";
import { pageLink, quickLink } from "./pageLink";

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
	if (isDailyNoteId(note.id)) return i18n.t("switcher.daily");
	return notes.find((n) => n.id === note.parentId)?.title || "";
}

export function Switcher({
	open,
	initialQuery,
	mode,
	onClose,
}: {
	open: boolean;
	initialQuery: string;
	/** "jump" (Ctrl+K): recent pages and "create". "search" (Ctrl+Shift+F): the text of every page. */
	mode: "jump" | "search";
	onClose: () => void;
}) {
	if (!open) return null;
	return (
		<SwitcherDialog initialQuery={initialQuery} mode={mode} onClose={onClose} />
	);
}

function SwitcherDialog({
	initialQuery,
	mode,
	onClose,
}: {
	initialQuery: string;
	mode: "jump" | "search";
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const searching = mode === "search";
	const notes = useNotes();
	const navigate = useNavigate();
	const { version, textOf } = useNoteTexts(notes, true);
	const [query, setQuery] = useState(initialQuery);
	const [cursor, setCursor] = useState(0);
	const [only, setOnly] = useState<NoteKind | null>(null);
	const input = useRef<HTMLInputElement>(null);
	const list = useRef<HTMLDivElement>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: version marks new body text arriving in the cache
	const found = useMemo(
		() => searchNotes(notes, textOf, query),
		[notes, query, version],
	);
	const trimmed = query.trim();
	// Search-all shows nothing until something is typed; jump shows recent pages.
	const shown = searching && !trimmed ? [] : found;
	const hits = useMemo(
		() => (only ? shown.filter((h) => h.note.kind === only) : shown),
		[shown, only],
	);
	const canCreate = !searching && trimmed !== "" && !trimmed.startsWith("#");
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
		void navigate(
			n.kind === "quick" ? quickLink(n.id, n.title) : pageLink(n.id, n.title),
		);
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
		} else if (e.key === "Tab") {
			e.preventDefault();
			const ids = [null, ...NOTE_TYPES.map((k) => k.id)];
			setOnly(ids[(ids.indexOf(only) + 1) % ids.length] ?? null);
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
		n.title ||
		(isDailyNoteId(n.id)
			? dailyTitle(new Date(), dateLocale())
			: t("common.untitled"));

	return (
		<div className="fixed inset-0 z-[60]">
			<button
				type="button"
				aria-label={t("switcher.close")}
				tabIndex={-1}
				onClick={onClose}
				className="absolute inset-0 bg-scrim"
			/>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={
					searching ? t("switcher.searchAll") : t("switcher.searchJump")
				}
				onKeyDown={onKeyDown}
				className="absolute inset-x-3 top-[max(12px,env(safe-area-inset-top))] mx-auto flex max-h-[calc(100dvh-24px)] max-w-[640px] flex-col overflow-hidden rounded-2xl border border-line bg-raised shadow-[0_24px_60px_rgba(40,30,15,0.22),0_2px_8px_rgba(40,30,15,0.1)] md:top-[112px] md:max-h-[calc(100dvh-160px)]"
			>
				<div className="flex h-[60px] flex-none items-center gap-3 border-b border-line2 px-[18px]">
					<Icon name="search" size={18} className="text-ink2" />
					<input
						ref={input}
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						aria-label={t("switcher.search")}
						placeholder={
							searching
								? t("switcher.placeholderAll")
								: t("switcher.placeholderJump")
						}
						autoComplete="off"
						spellCheck={false}
						className="min-w-0 flex-1 bg-transparent text-lg text-ink outline-none placeholder:text-mute"
					/>
					<kbd className="rounded-full border border-line px-1.5 py-0.5 font-mono text-[11px] text-mute">
						Esc
					</kbd>
				</div>

				{/* biome-ignore lint/a11y/useSemanticElements: a row of filter chips, not a form group */}
				<div
					className="flex flex-none gap-1.5 overflow-x-auto border-b border-line2 px-[18px] py-2"
					role="group"
					aria-label={t("switcher.filter")}
				>
					{[
						{ id: null, short: t("switcher.all") },
						...NOTE_TYPES.map((k) => ({
							id: k.id,
							short: t(`kinds.${k.id}.name`),
						})),
					].map((c) => (
						<button
							key={c.id ?? "all"}
							type="button"
							aria-pressed={only === c.id}
							onClick={() => setOnly(c.id)}
							className={`flex-none rounded-full border px-2.5 py-0.5 text-xs ${only === c.id ? "border-accent bg-accent-soft text-accent" : "border-line text-ink2 hover:bg-hover"}`}
						>
							{c.short}
						</button>
					))}
				</div>

				<div
					ref={list}
					className="min-h-0 flex-1 overflow-y-auto px-2 pt-2.5 pb-1.5"
				>
					<div className="px-3 py-1.5 text-[11px] font-medium tracking-[0.09em] text-mute uppercase">
						{searching
							? t("switcher.matches")
							: trimmed
								? t("switcher.notes")
								: t("switcher.recent")}
					</div>
					{hits.length === 0 ? (
						<p className="px-3 py-2 text-sm text-mute">
							{searching && !trimmed
								? t("switcher.typeToSearch")
								: trimmed
									? t("switcher.nothing")
									: t("sidebar.empty")}
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
								<span className="flex items-center gap-2.5">
									<KindGlyph
										kind={hit.note.kind}
										size={14}
										className="shrink-0 text-mute"
									/>
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
										<mark className="rounded-full bg-mark px-0.5 text-inherit">
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
								{t("switcher.actions")}
							</div>
							<button
								type="button"
								role="option"
								aria-selected={cursor === hits.length}
								onMouseMove={() => setCursor(hits.length)}
								onClick={create}
								className={`flex w-full items-center gap-3 rounded-full px-3 py-2.5 text-left text-sm ${cursor === hits.length ? "bg-hover" : ""}`}
							>
								<Icon name="plus" size={16} className="text-ink2" />
								<span className="truncate">
									{t("switcher.create", { title: trimmed })}
								</span>
							</button>
						</>
					) : null}
				</div>

				<div className="flex flex-none gap-[18px] border-t border-line2 px-[18px] py-2.5 text-xs text-mute">
					<span>{t("switcher.hintMove")}</span>
					<span>{t("switcher.hintTab")}</span>
					<span>{t("switcher.hintEnter")}</span>
					<span className="ml-auto">
						{trimmed
							? t("switcher.count", {
									hits: hits.length,
									count: shown.length,
								}) +
								(only ? ` · ${t(`kinds.${only}.name`)}` : "") +
								` · ${t("switcher.onDevice")}`
							: t("switcher.onDevice")}
					</span>
				</div>
			</div>
		</div>
	);
}
