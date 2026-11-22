import type { BlockNoteEditor } from "@blocknote/core";
import {
	changeKind,
	createNote,
	getNote,
	type NoteMeta,
	purgeNote,
	setField,
	trashNote,
	updateNote,
} from "@seijaku/sync";
import { Link, useNavigate } from "@tanstack/react-router";
import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "../components/Icon";
import { pageLink, quickLink } from "../components/pageLink";
import { TINTS, tintVar } from "../components/tints";
import { fragmentBlocks } from "../editor/headless";
import { useNoteId, useNoteSession, useNotes } from "../workspace/hooks";
import { workspace } from "../workspace/store";

const Editor = lazy(() =>
	import("../editor/Editor").then((m) => ({ default: m.Editor })),
);

// biome-ignore lint/suspicious/noExplicitAny: the editor is read through its untyped runtime API
type AnyBlock = any;

const quickField = (n: NoteMeta, key: string) => n.fields.quick?.[key];
const pinned = (n: NoteMeta) => quickField(n, "pinned") === true;

const openCards = new Set<string>();

/** A card with no title and nothing but empty lines or empty to-dos in its body. */
async function isBlank(id: string): Promise<boolean> {
	const note = getNote(workspace.index, id);
	if (!note || note.title.trim()) return false;
	workspace.openNote(id);
	return workspace.withFragment(id, (f) =>
		fragmentBlocks(f).every(
			(b) =>
				(b.type === "paragraph" || b.type === "checkListItem") &&
				b.children.length === 0 &&
				!(Array.isArray(b.content) ? b.content : []).some(
					(c: { text?: string }) => (c.text ?? "").trim() || !("text" in c),
				),
		),
	);
}

/** The Keep-style wall: every quick note as a card, pinned ones first. A card opens over the wall. */
export function QuickNotesPage() {
	const { t } = useTranslation();
	const notes = useNotes();
	const navigate = useNavigate();
	const openId = useNoteId();
	const parents = useMemo(
		() => new Set(notes.filter((n) => !n.trashed).map((n) => n.parentId)),
		[notes],
	);
	const cards = useMemo(
		() =>
			notes
				.filter((n) => n.kind === "quick" && !n.trashed && !parents.has(n.id))
				.sort((a, b) => b.updatedAt - a.updatedAt),
		[notes, parents],
	);
	const pins = cards.filter(pinned);
	const others = cards.filter((n) => !pinned(n));

	useEffect(() => {
		document.title = t("quick.pageTitle");
	}, [t]);

	// Blank cards from before empty ones were refused. Recent ones are left alone (someone may be typing).
	const stale = cards
		.filter((n) => n.id !== openId && Date.now() - n.updatedAt > 60_000)
		.map((n) => n.id)
		.join(",");
	useEffect(() => {
		for (const id of stale ? stale.split(",") : [])
			void isBlank(id).then((blank) => blank && purgeNote(workspace.index, id));
	}, [stale]);

	const take = () => {
		const id = createNote(workspace.index, { kind: "quick" });
		void navigate(quickLink(id, ""));
	};

	return (
		<div className="mx-auto w-full max-w-[1000px] px-5 pt-10 pb-24 md:pt-[72px]">
			<h1 className="mb-6 flex items-center gap-3 font-serif text-[42px] leading-[1.1] font-medium md:text-[56px]">
				<Icon name="wall" size={32} className="text-mute" />
				{t("sidebar.quickNotes")}
			</h1>
			<button
				type="button"
				onClick={take}
				className="mb-8 flex h-12 w-full max-w-xl items-center gap-2.5 rounded-full border border-line bg-raised px-4 text-left text-[15px] text-mute shadow-sm hover:border-mute"
			>
				<Icon name="plus" size={16} />
				{t("quick.take")}
			</button>
			{cards.length === 0 ? (
				<p className="text-mute">{t("quick.empty")}</p>
			) : null}
			<Wall title={t("today.pinned")} cards={pins} />
			<Wall title={pins.length ? t("quick.others") : ""} cards={others} />
			{openId ? <Card id={openId} /> : null}
		</div>
	);
}

function Wall({ title, cards }: { title: string; cards: NoteMeta[] }) {
	if (cards.length === 0) return null;
	return (
		<section className="mb-8">
			{title ? (
				<h2 className="mb-3 text-[11px] font-medium tracking-[0.09em] text-mute uppercase">
					{title}
				</h2>
			) : null}
			<div className="columns-2 gap-3.5 md:columns-3 [&>*]:mb-3.5">
				{cards.map((n) => (
					<WallCard key={n.id} note={n} />
				))}
			</div>
		</section>
	);
}

function WallCard({ note }: { note: NoteMeta }) {
	const { t } = useTranslation();
	const isPinned = pinned(note);
	return (
		<div
			className="group relative break-inside-avoid rounded-2xl border border-line2 p-3.5 transition-shadow hover:shadow-md"
			style={{ background: tintVar(quickField(note, "tint")) }}
		>
			<Link
				{...quickLink(note.id, note.title)}
				className="block min-h-10 after:absolute after:inset-0"
			>
				<div className="font-medium text-ink">
					{note.title || <span className="text-mute">Untitled</span>}
				</div>
				<CardText id={note.id} stamp={note.updatedAt} />
			</Link>
			<div className="relative z-10 mt-2 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100">
				<button
					type="button"
					aria-label={isPinned ? t("quick.unpin") : t("quick.pin")}
					aria-pressed={isPinned}
					onClick={() =>
						setField(
							workspace.index,
							note.id,
							"quick",
							"pinned",
							isPinned ? null : true,
						)
					}
					className={`flex size-8 items-center justify-center rounded-full hover:bg-hover ${isPinned ? "text-accent" : "text-ink2"}`}
				>
					<Icon name="pin" size={14} />
				</button>
				<button
					type="button"
					aria-label={t("quick.toPage")}
					onClick={() => changeKind(workspace.index, note.id, "page")}
					className="flex size-8 items-center justify-center rounded-full text-ink2 hover:bg-hover"
				>
					<Icon name="page" size={14} />
				</button>
				<button
					type="button"
					aria-label={t("sidebar.moveToTrash")}
					onClick={() => trashNote(workspace.index, note.id)}
					className="flex size-8 items-center justify-center rounded-full text-ink2 hover:bg-hover"
				>
					<Icon name="trash" size={14} />
				</button>
			</div>
		</div>
	);
}

/** The first lines of a card, read on this device and re-read when the note is edited. */
function CardText({ id, stamp }: { id: string; stamp: number }) {
	const [text, setText] = useState("");
	// biome-ignore lint/correctness/useExhaustiveDependencies: stamp is the note's edit time, which re-reads the text
	useEffect(() => {
		let stale = false;
		void workspace.readText(id).then((t) => !stale && setText(t.trim()));
		return () => {
			stale = true;
		};
	}, [id, stamp]);
	return (
		<p className="mt-1 line-clamp-6 text-[13px] leading-normal whitespace-pre-line text-ink2">
			{text}
		</p>
	);
}

/** One card open over the wall: optional title, body, tint, pin, Close. Esc or a click outside closes. */
function Card({ id }: { id: string }) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const note = useNotes().find((n) => n.id === id);
	const session = useNoteSession(id);
	const focus = useRef<(() => void) | null>(null);
	const editorRef = useRef<BlockNoteEditor<
		AnyBlock,
		AnyBlock,
		AnyBlock
	> | null>(null);
	const [ticks, setTicks] = useState(false);
	const hasTicks = () =>
		editorRef.current?.document.some((b) => b.type === "checkListItem") ??
		false;
	// The editor mounts a moment after the card opens.
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-read once per card
	useEffect(() => {
		const t = setTimeout(() => setTicks(hasTicks()), 400);
		return () => clearTimeout(t);
	}, [id]);
	/** Turns the card's paragraphs into to-dos, or back. */
	const toggleTicks = () => {
		const ed = editorRef.current;
		if (!ed) return;
		const on = hasTicks();
		for (const b of ed.document) {
			if (on && b.type === "checkListItem")
				ed.updateBlock(b, { type: "paragraph" });
			else if (!on && b.type === "paragraph")
				ed.updateBlock(b, { type: "checkListItem" });
		}
		setTicks(!on);
	};
	const close = useCallback(
		() => void navigate({ to: "/quick-notes" }),
		[navigate],
	);
	useEffect(() => {
		const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
		window.addEventListener("keydown", esc);
		return () => window.removeEventListener("keydown", esc);
	}, [close]);
	// A quick note needs a title or a body: leaving an empty card throws it away.
	// (The delay lets a development remount re-register before this decides.)
	useEffect(() => {
		openCards.add(id);
		return () => {
			openCards.delete(id);
			setTimeout(() => {
				if (!openCards.has(id))
					void isBlank(id).then(
						(blank) => blank && purgeNote(workspace.index, id),
					);
			}, 50);
		};
	}, [id]);
	const away = note !== undefined && note.kind !== "quick";
	useEffect(() => {
		if (away && note)
			void navigate({ ...pageLink(note.id, note.title), replace: true });
	}, [away, note, navigate]);
	if (!note || away) return null;
	const tint = quickField(note, "tint");
	const isPinned = pinned(note);
	return (
		<div className="fixed inset-0 z-40 flex items-center justify-center p-3">
			<button
				type="button"
				aria-label={t("quick.closeNote")}
				tabIndex={-1}
				onClick={close}
				className="absolute inset-0 bg-scrim"
			/>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={t("today.quickNote")}
				className="relative flex max-h-[85dvh] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl border border-line shadow-2xl"
				style={{ background: tintVar(tint) }}
			>
				<div className="flex items-start gap-2 px-5 pt-4">
					<input
						value={note.title}
						aria-label={t("quick.title")}
						placeholder={t("quick.title")}
						// biome-ignore lint/a11y/noAutofocus: a new card opens ready to type
						autoFocus={note.title === ""}
						onChange={(e) =>
							updateNote(workspace.index, id, { title: e.target.value })
						}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								focus.current?.();
							}
						}}
						className="min-w-0 flex-1 bg-transparent font-serif text-2xl outline-none placeholder:text-mute/70"
					/>
					<button
						type="button"
						aria-label={isPinned ? t("quick.unpin") : t("quick.pin")}
						aria-pressed={isPinned}
						onClick={() =>
							setField(
								workspace.index,
								id,
								"quick",
								"pinned",
								isPinned ? null : true,
							)
						}
						className={`flex size-9 items-center justify-center rounded-full hover:bg-hover ${isPinned ? "text-accent" : "text-ink2"}`}
					>
						<Icon name="pin" size={16} />
					</button>
				</div>
				<div className="min-h-[120px] flex-1 overflow-y-auto px-2 pb-2">
					{session?.id === id ? (
						<Suspense fallback={null}>
							<Editor
								key={`card-${id}`}
								session={session}
								focusRef={focus}
								editorRef={editorRef}
								autoFocus={note.title !== ""}
							/>
						</Suspense>
					) : null}
				</div>
				<div className="flex items-center gap-2 border-t border-line2 px-4 py-2.5">
					{/* biome-ignore lint/a11y/useSemanticElements: a row of swatch buttons, not a form group */}
					<div
						className="flex gap-1.5"
						role="group"
						aria-label={t("quick.colour")}
					>
						{TINTS.map((tn) => (
							<button
								key={tn}
								type="button"
								aria-label={t(`tint.${tn}`)}
								aria-pressed={tint === tn}
								onClick={() =>
									setField(workspace.index, id, "quick", "tint", tn)
								}
								className={`size-6 rounded-full border ${tint === tn ? "border-ink" : "border-line"}`}
								style={{ background: tintVar(tn) }}
							/>
						))}
					</div>
					<span className="flex-1" />
					<button
						type="button"
						aria-pressed={ticks}
						onClick={toggleTicks}
						className="h-9 rounded-full px-3 text-[13px] text-ink2 hover:bg-hover"
					>
						{ticks ? t("quick.hideTicks") : t("quick.showTicks")}
					</button>
					<button
						type="button"
						onClick={close}
						className="h-9 rounded-full px-4 text-[13px] font-medium hover:bg-hover"
					>
						{t("common.close")}
					</button>
				</div>
			</div>
		</div>
	);
}
