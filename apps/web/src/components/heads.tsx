import {
	addToField,
	getNote,
	JOURNAL_ID,
	type NoteKind,
	type NoteMeta,
	removeFromField,
	setField,
	updateNote,
} from "@seijaku/sync";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type * as Y from "yjs";
import { type Block, fragmentBlocks } from "../editor/headless";
import { todoCounts } from "../editor/todos";
import { dateLocale } from "../i18n";
import { resolveFileUrl, uploadFile } from "../workspace/files";
import { readLocal, useNotes, writeLocal } from "../workspace/hooks";
import { workspace } from "../workspace/store";
import { DatePicker } from "./DatePicker";
import { isoDay } from "./dates";
import { Icon, type IconName } from "./Icon";
import { pageLink } from "./pageLink";
import { TINTS, tintVar } from "./tints";

/** The fields of a note's own type, as strings (everything is stored as plain values). */
const val = (note: NoteMeta, kind: NoteKind, key: string): string => {
	const v = note.fields[kind]?.[key];
	return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
};
const list = (note: NoteMeta, kind: NoteKind, key: string): unknown[] => {
	const v = note.fields[kind]?.[key];
	return Array.isArray(v) ? v : [];
};
const put = (
	note: NoteMeta,
	kind: NoteKind,
	key: string,
	value: string | number | null,
) => setField(workspace.index, note.id, kind, key, value);

const fromIso = (s: string) => {
	const [y, m, d] = s.split("-").map(Number);
	return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
};
const addDays = (iso: string, n: number) => {
	const d = fromIso(iso);
	d.setDate(d.getDate() + n);
	return isoDay(d);
};

/** A text box that keeps what is being typed and still picks up changes from other devices. */
function FieldInput({
	note,
	kind,
	name,
	label,
	placeholder,
	type = "text",
	className = "",
	multiline = false,
}: {
	note: NoteMeta;
	kind: NoteKind;
	name: string;
	label: string;
	placeholder?: string;
	type?: "text" | "date" | "time" | "url";
	className?: string;
	multiline?: boolean;
}) {
	const stored = val(note, kind, name);
	const [value, setValue] = useState(stored);
	const el = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
	useEffect(() => {
		if (document.activeElement !== el.current) setValue(stored);
	}, [stored]);
	const props = {
		ref: el,
		value,
		placeholder,
		"aria-label": label,
		onChange: (
			e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>,
		) => {
			setValue(e.target.value);
			put(note, kind, name, e.target.value);
		},
		className: `bg-transparent outline-none placeholder:text-mute/70 ${className}`,
	};
	if (type === "date")
		return (
			<DatePicker
				value={stored}
				label={label}
				className={className}
				onChange={(iso) => put(note, kind, name, iso)}
			/>
		);
	return multiline ? (
		<textarea rows={1} {...props} />
	) : (
		<input type={type} {...props} />
	);
}

const kicker =
	"mb-2 flex items-center gap-2 font-mono text-[11px] tracking-[0.1em] text-mute uppercase";

/* ---------- Page: cover and icon ---------- */

const ICON_GROUPS: [string, string[]][] = [
	[
		"Pages",
		["📄", "📝", "📓", "📚", "📖", "🗂️", "📌", "🔖", "🧾", "📋", "🗒️", "📎"],
	],
	[
		"Ideas",
		["💡", "🎯", "🧭", "🧠", "✨", "🔭", "🧩", "🎨", "🛠️", "⚙️", "🔬", "🧪"],
	],
	[
		"Work",
		["✅", "📅", "⏰", "📈", "💼", "📧", "📞", "🤝", "🏁", "💰", "🧮", "🔒"],
	],
	[
		"Life",
		["🏠", "🌿", "🌸", "☕", "🍜", "✈️", "🎵", "📷", "🎮", "💪", "❤️", "🌙"],
	],
];

/** The cover: a tint, or a sealed image from `uploadFile` (read back through `resolveFileUrl`). */
function Cover({ cover }: { cover: string }) {
	const { t } = useTranslation();
	const isTint = (TINTS as readonly string[]).includes(cover);
	const [src, setSrc] = useState("");
	useEffect(() => {
		if (isTint) return;
		let stale = false;
		void resolveFileUrl(cover).then((u) => !stale && setSrc(u));
		return () => {
			stale = true;
		};
	}, [cover, isTint]);
	return (
		<div
			role="img"
			aria-label={t("heads.cover")}
			className="h-32 rounded-2xl bg-cover bg-center md:h-44"
			style={
				isTint
					? { background: tintVar(cover) }
					: {
							backgroundImage: src ? `url("${src}")` : undefined,
							backgroundColor: tintVar("washi"),
						}
			}
		/>
	);
}

export function PageHead({ note }: { note: NoteMeta }) {
	const { t } = useTranslation();
	const cover = val(note, "page", "cover");
	const [picking, setPicking] = useState(false);
	const [iconOpen, setIconOpen] = useState(false);
	const [problem, setProblem] = useState("");
	const file = useRef<HTMLInputElement>(null);
	const [link, setLink] = useState("");
	const setIcon = (icon: string | null) => {
		updateNote(workspace.index, note.id, { icon });
		setIconOpen(false);
	};
	/** A public image address (Unsplash, Pexels, any site): checked that it loads as a picture, then kept as the cover. */
	const applyLink = () => {
		setProblem("");
		let url: URL;
		try {
			url = new URL(link.trim());
			if (!/^https?:$/.test(url.protocol)) throw new Error();
		} catch {
			return setProblem(t("heads.badUrl"));
		}
		const img = new Image();
		img.onload = () => {
			put(note, "page", "cover", url.href);
			setLink("");
			setPicking(false);
		};
		img.onerror = () => setProblem(t("heads.notImage"));
		img.src = url.href;
	};
	const upload = async (f: File | undefined) => {
		if (!f) return;
		setProblem("");
		try {
			put(note, "page", "cover", await uploadFile(f));
			setPicking(false);
		} catch (e) {
			setProblem(e instanceof Error ? e.message : t("heads.addFailed"));
		}
	};
	return (
		<div className="-mx-5 mb-2 md:-mx-0">
			{cover ? <Cover cover={cover} /> : null}
			<div className={`flex items-end gap-3 ${cover ? "-mt-7 px-5" : "px-5"}`}>
				{note.icon || cover || iconOpen ? (
					<div className="relative">
						<button
							type="button"
							aria-label={t("heads.pageIcon")}
							aria-expanded={iconOpen}
							onClick={() => setIconOpen((v) => !v)}
							className="size-14 rounded-2xl border border-line bg-raised text-center text-3xl text-mute"
						>
							{note.icon || "+"}
						</button>
						{iconOpen ? (
							<div className="absolute top-full left-0 z-20 mt-1 w-64 rounded-2xl border border-line bg-raised p-2 shadow-lg">
								<div className="max-h-64 overflow-y-auto pr-1">
									{ICON_GROUPS.map(([name, set]) => (
										<div key={name} className="mb-1.5">
											<div className="px-1 py-1 text-[11px] font-medium tracking-[0.09em] text-mute uppercase">
												{t(`heads.iconGroups.${name as "Pages"}`)}
											</div>
											<div className="grid grid-cols-6 gap-1">
												{set.map((e) => (
													<button
														key={e}
														type="button"
														aria-label={t("heads.icon", { icon: e })}
														onClick={() => setIcon(e)}
														className="size-9 rounded-xl text-xl hover:bg-hover"
													>
														{e}
													</button>
												))}
											</div>
										</div>
									))}
								</div>
								<div className="mt-2 flex items-center gap-2 text-[12px] text-mute">
									<input
										aria-label={t("heads.typeChar")}
										placeholder={t("heads.typeAny")}
										maxLength={2}
										onChange={(e) => e.target.value && setIcon(e.target.value)}
										className="w-20 rounded-xl border border-line bg-transparent px-2 py-1 text-ink outline-none"
									/>
									{note.icon ? (
										<button
											type="button"
											onClick={() => setIcon(null)}
											className="rounded-2xl px-2 py-1 hover:bg-hover"
										>
											{t("common.remove")}
										</button>
									) : null}
								</div>
							</div>
						) : null}
					</div>
				) : null}
				<div className="flex-1" />
				<div className="relative flex gap-1.5 text-[12px] text-mute">
					{!note.icon && !cover && !iconOpen ? (
						<button
							type="button"
							onClick={() => setIconOpen(true)}
							className="flex items-center gap-1 rounded-2xl px-2 py-1 hover:bg-hover"
						>
							<Icon name="page" size={13} /> {t("heads.addIcon")}
						</button>
					) : null}
					<button
						type="button"
						onClick={() => setPicking((v) => !v)}
						aria-expanded={picking}
						className="flex items-center gap-1 rounded-2xl px-2 py-1 hover:bg-hover"
					>
						<Icon name="palette" size={13} />
						{cover ? t("heads.changeCover") : t("heads.addCover")}
					</button>
					{picking ? (
						<div className="absolute top-full right-0 z-20 mt-1 flex w-72 flex-wrap items-center gap-1.5 rounded-2xl border border-line bg-raised p-2 shadow-lg">
							{TINTS.map((tn) => (
								<button
									key={tn}
									type="button"
									aria-label={t("heads.coverTint", { tint: t(`tint.${tn}`) })}
									aria-pressed={cover === tn}
									onClick={() => {
										put(note, "page", "cover", tn);
										setPicking(false);
									}}
									className={`size-7 rounded-full border ${cover === tn ? "border-ink" : "border-line"}`}
									style={{ background: tintVar(tn) }}
								/>
							))}
							<div className="flex w-full gap-1.5">
								<input
									type="url"
									value={link}
									placeholder={t("heads.pasteLink")}
									aria-label={t("heads.coverLink")}
									onChange={(e) => setLink(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											e.preventDefault();
											applyLink();
										}
									}}
									className="min-w-0 flex-1 rounded-xl border border-line bg-transparent px-2.5 py-1 text-ink outline-none placeholder:text-mute"
								/>
								<button
									type="button"
									onClick={applyLink}
									className="rounded-xl border border-line px-2.5 py-1 text-ink hover:bg-hover"
								>
									{t("heads.use")}
								</button>
							</div>
							<input
								ref={file}
								type="file"
								accept="image/*"
								hidden
								onChange={(e) => void upload(e.target.files?.[0])}
							/>
							<button
								type="button"
								onClick={() => file.current?.click()}
								className="rounded-2xl px-2 py-1 hover:bg-hover"
							>
								{t("heads.upload")}
							</button>
							{cover ? (
								<button
									type="button"
									onClick={() => {
										put(note, "page", "cover", null);
										setPicking(false);
									}}
									className="rounded-2xl px-2 py-1 hover:bg-hover"
								>
									{t("common.remove")}
								</button>
							) : null}
							{problem ? (
								<p role="alert" className="w-full px-1 text-accent">
									{problem}
								</p>
							) : null}
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}

/* ---------- Checklist ---------- */

export function ChecklistHead({
	note,
	children,
}: {
	note: NoteMeta;
	/** The title field, shown right under the kicker. */
	children?: React.ReactNode;
}) {
	const { t } = useTranslation();
	const [counts, setCounts] = useState({ done: 0, total: 0 });
	// biome-ignore lint/correctness/useExhaustiveDependencies: updatedAt moves on every content edit
	useEffect(() => {
		let stale = false;
		void workspace
			.withFragment(note.id, (f: Y.XmlFragment) => todoCounts(f))
			.then((c) => !stale && setCounts(c));
		return () => {
			stale = true;
		};
	}, [note.id, note.updatedAt]);
	const due = val(note, "checklist", "due");
	const overdue = due !== "" && due < isoDay(new Date());
	const pct = counts.total ? Math.round((counts.done / counts.total) * 100) : 0;
	return (
		<div className="mb-5 flex flex-col gap-3">
			<div className={kicker}>
				<Icon name="checklist" size={13} /> {t("heads.checklist")}
			</div>
			{children}
			<div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-ink2">
				<div className="flex items-center gap-1.5">
					<Icon name="flag" size={13} className="text-mute" />
					<span className={overdue ? "text-accent" : ""}>{t("heads.due")}</span>
					<FieldInput
						note={note}
						kind="checklist"
						name="due"
						label={t("heads.dueDate")}
						type="date"
						className={`rounded-lg px-1 ${overdue ? "text-accent" : ""}`}
					/>
				</div>
				<span aria-live="polite">
					{counts.done} of {counts.total} done
				</span>
				<HideDone id={note.id} />
			</div>
			<div
				role="progressbar"
				aria-label={t("heads.progress")}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={pct}
				className="h-1 overflow-hidden rounded-full bg-tag"
			>
				<div className="h-full bg-accent" style={{ width: `${pct}%` }} />
			</div>
		</div>
	);
}

const hideKey = (id: string) => `seijaku-hide-done-${id}`;
export const hidesDone = (id: string) => readLocal(hideKey(id)) === "1";

function HideDone({ id }: { id: string }) {
	const { t } = useTranslation();
	const [on, setOn] = useState(() => hidesDone(id));
	useEffect(() => {
		document
			.querySelector("article[data-kind]")
			?.toggleAttribute("data-hide-done", on);
		return () =>
			document
				.querySelector("article[data-kind]")
				?.removeAttribute("data-hide-done");
	}, [on]);
	return (
		<button
			type="button"
			aria-pressed={on}
			onClick={() => {
				writeLocal(hideKey(id), on ? "0" : "1");
				setOn(!on);
			}}
			className="rounded-2xl px-2 py-0.5 hover:bg-hover"
		>
			{on ? t("heads.showDone") : t("heads.hideDone")}
		</button>
	);
}

/* ---------- Journal ---------- */

const MOODS = ["Heavy", "Low", "Even", "Good", "Bright"] as const;
const WEATHER = ["sun", "cloud", "rain", "snow", "wind"] as const;

export const journalDate = (id: string): Date | null => {
	const m = /^journal-(\d{4}-\d{2}-\d{2})$/.exec(id);
	return m?.[1] ? fromIso(m[1]) : null;
};

export function JournalHead({ note }: { note: NoteMeta }) {
	const { t } = useTranslation();
	const notes = useNotes();
	const date = journalDate(note.id) ?? new Date(note.createdAt);
	const entries = useMemo(
		() =>
			notes
				.filter((n) => n.kind === "journal" && !n.trashed)
				.map((n) => n.id)
				.sort(),
		[notes],
	);
	const prev = [...entries].reverse().find((id) => id < note.id);
	const next = entries.find((id) => id > note.id);
	const mood = val(note, "journal", "mood");
	const weather = val(note, "journal", "weather");
	const nav = (id: string | undefined, label: string, glyph: IconName) => {
		const n = id ? getNote(workspace.index, id) : undefined;
		const cls =
			"flex items-center gap-1 rounded-2xl px-2 py-1 text-[13px] text-ink2 hover:bg-hover";
		return n ? (
			<Link {...pageLink(n.id, n.title)} className={cls} aria-label={label}>
				{glyph === "back" ? <Icon name="back" size={13} /> : null}
				{label}
				{glyph === "forward" ? <Icon name="forward" size={13} /> : null}
			</Link>
		) : (
			<span className={`${cls} opacity-40`} aria-disabled="true">
				{glyph === "back" ? <Icon name="back" size={13} /> : null}
				{label}
				{glyph === "forward" ? <Icon name="forward" size={13} /> : null}
			</span>
		);
	};
	return (
		<header className="mb-6 flex flex-col gap-4">
			<div className="flex items-center gap-2">
				{nav(prev, t("heads.previous"), "back")}
				<span className="flex-1" />
				<span className="font-serif text-[15px] text-mute">日記</span>
				<span className="flex-1" />
				{nav(next, t("heads.next"), "forward")}
			</div>
			<div>
				<div className={kicker}>
					{date.toLocaleDateString(dateLocale(), { weekday: "long" })}
				</div>
				<h1 className="font-serif text-[56px] leading-none font-medium tracking-[-0.02em] md:text-[72px]">
					{date.toLocaleDateString(dateLocale(), {
						day: "numeric",
						month: "long",
					})}
				</h1>
				<div className="mt-1 text-sm text-mute">{date.getFullYear()}</div>
			</div>
			<FieldInput
				note={note}
				kind="journal"
				name="dayTitle"
				label={t("heads.dayTitle")}
				placeholder={t("heads.dayTitlePlaceholder")}
				className="font-serif text-2xl italic"
			/>
			<div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-[13px]">
				{/* biome-ignore lint/a11y/useSemanticElements: a row of toggle buttons, not a form group */}
				<div role="group" aria-label={t("heads.mood")} className="flex gap-1">
					{MOODS.map((m, i) => (
						<button
							key={m}
							type="button"
							aria-pressed={mood === String(i)}
							onClick={() =>
								put(note, "journal", "mood", mood === String(i) ? null : i)
							}
							className={`rounded-full border px-2.5 py-1 ${mood === String(i) ? "border-accent bg-accent-soft text-accent" : "border-line text-ink2 hover:bg-hover"}`}
						>
							{t(`heads.moods.${m}`)}
						</button>
					))}
				</div>
				{/* biome-ignore lint/a11y/useSemanticElements: a row of toggle buttons, not a form group */}
				<div
					role="group"
					aria-label={t("heads.weatherLabel")}
					className="flex gap-0.5"
				>
					{WEATHER.map((w) => (
						<button
							key={w}
							type="button"
							aria-pressed={weather === w}
							aria-label={t(`heads.weather.${w}`)}
							onClick={() =>
								put(note, "journal", "weather", weather === w ? null : w)
							}
							className={`flex size-8 items-center justify-center rounded-full ${weather === w ? "bg-accent-soft text-accent" : "text-mute hover:bg-hover"}`}
						>
							<Icon name={w} size={15} />
						</button>
					))}
				</div>
				<div className="flex items-center gap-1.5 text-ink2">
					<Icon name="place" size={14} className="text-mute" />
					<FieldInput
						note={note}
						kind="journal"
						name="place"
						label={t("heads.place")}
						placeholder={t("heads.where")}
						className="w-32"
					/>
				</div>
			</div>
			<div className="flex flex-col gap-1">
				<span className="text-xs text-mute">{t("heads.highlight")}</span>
				<FieldInput
					note={note}
					kind="journal"
					name="highlight"
					label={t("heads.highlight")}
					placeholder={t("heads.highlightPlaceholder")}
					className="border-b border-line2 pb-1 font-serif text-lg"
				/>
			</div>
		</header>
	);
}

/** The "Journal" page itself: a month at a glance, with a mood strip and the entries. */
export function JournalMonth() {
	const { t } = useTranslation();
	const notes = useNotes();
	const [month, setMonth] = useState(() => isoDay(new Date()).slice(0, 7));
	const entries = useMemo(
		() =>
			notes
				.filter(
					(n) =>
						n.kind === "journal" &&
						!n.trashed &&
						n.id.startsWith(`journal-${month}`),
				)
				.sort((a, b) => (a.id < b.id ? -1 : 1)),
		[notes, month],
	);
	const [y, m] = month.split("-").map(Number) as [number, number];
	const days = new Date(y, m, 0).getDate();
	const byDay = new Map(entries.map((n) => [Number(n.id.slice(-2)), n]));
	const today = isoDay(new Date());
	const shift = (by: number) =>
		setMonth(isoDay(new Date(y, m - 1 + by, 1)).slice(0, 7));
	return (
		<section aria-label={t("heads.journalMonth")} className="mb-8">
			<div className="mb-3 flex items-center gap-2">
				<button
					type="button"
					aria-label={t("datePicker.prev")}
					onClick={() => shift(-1)}
					className="rounded-2xl p-1.5 hover:bg-hover"
				>
					<Icon name="back" />
				</button>
				<h2 className="flex-1 text-center font-serif text-2xl">
					{new Date(y, m - 1, 1).toLocaleDateString(dateLocale(), {
						month: "long",
						year: "numeric",
					})}
				</h2>
				<button
					type="button"
					aria-label={t("datePicker.next")}
					onClick={() => shift(1)}
					className="rounded-2xl p-1.5 hover:bg-hover"
				>
					<Icon name="forward" />
				</button>
			</div>
			<div className="mb-4 flex gap-[3px]" aria-hidden="true">
				{Array.from({ length: days }, (_, i) => {
					const n = byDay.get(i + 1);
					const mood = n ? val(n, "journal", "mood") : "";
					const iso = `${month}-${String(i + 1).padStart(2, "0")}`;
					return (
						<span
							key={iso}
							className={`h-6 flex-1 rounded-sm ${n ? "" : "border border-dashed border-line"} ${iso === today ? "ring-2 ring-accent" : ""}`}
							style={
								n
									? {
											background: `color-mix(in srgb, var(--accent) ${15 + (mood === "" ? 0 : Number(mood)) * 20}%, var(--tag))`,
										}
									: undefined
							}
						/>
					);
				})}
			</div>
			{entries.length === 0 ? (
				<p className="text-sm text-mute">{t("heads.noEntries")}</p>
			) : (
				<ul className="flex flex-col">
					{entries.map((n) => {
						const d = journalDate(n.id) ?? new Date();
						const w = val(n, "journal", "weather") as IconName;
						return (
							<li key={n.id} className="border-t border-line2">
								<Link
									{...pageLink(n.id, n.title)}
									className="flex items-baseline gap-3 py-2.5 hover:bg-hover/50"
								>
									<span className="w-8 font-serif text-xl">{d.getDate()}</span>
									<span className="w-10 text-xs text-mute">
										{d.toLocaleDateString(dateLocale(), { weekday: "short" })}
									</span>
									<span className="min-w-0 flex-1 truncate text-sm text-ink2">
										{val(n, "journal", "highlight") ||
											val(n, "journal", "dayTitle")}
									</span>
									{(WEATHER as readonly string[]).includes(w) ? (
										<Icon name={w} size={14} className="text-mute" />
									) : null}
									<span className="text-xs text-mute">
										{val(n, "journal", "place")}
									</span>
								</Link>
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}

export const isJournalPage = (id: string) => id === JOURNAL_ID;

/* ---------- Meeting ---------- */

export function MeetingHead({
	note,
	children,
}: {
	note: NoteMeta;
	/** The title field, shown right under the kicker. */
	children?: React.ReactNode;
}) {
	const { t } = useTranslation();
	const [adding, setAdding] = useState("");
	const attendees = list(note, "meeting", "attendees") as string[];
	const row = "flex items-center gap-3 border-b border-line2 py-2";
	const lab = "flex w-20 items-center gap-1.5 text-xs text-mute";
	return (
		<div className="mb-6 flex flex-col">
			<div className={kicker}>
				<Icon name="meeting" size={13} /> {t("heads.meeting")}
			</div>
			{children}
			<div className="mt-2 flex flex-col border-t border-line2 text-sm">
				<div className={row}>
					<span className={lab}>
						<Icon name="clock" size={13} /> {t("heads.when")}
					</span>
					<FieldInput
						note={note}
						kind="meeting"
						name="date"
						label={t("heads.date")}
						type="date"
					/>
					<FieldInput
						note={note}
						kind="meeting"
						name="start"
						label={t("heads.start")}
						type="time"
					/>
					<span className="text-mute">to</span>
					<FieldInput
						note={note}
						kind="meeting"
						name="end"
						label={t("heads.end")}
						type="time"
					/>
				</div>
				<div className={row}>
					<span className={lab}>
						<Icon name="place" size={13} /> {t("heads.where")}
					</span>
					<FieldInput
						note={note}
						kind="meeting"
						name="place"
						label={t("heads.place")}
						placeholder={t("heads.room")}
						className="min-w-0 flex-1"
					/>
					<Icon name="link" size={13} className="text-mute" />
					<FieldInput
						note={note}
						kind="meeting"
						name="link"
						label={t("heads.meetingLink")}
						type="url"
						placeholder={t("heads.link")}
						className="min-w-0 flex-1"
					/>
				</div>
				<div className={`${row} flex-wrap`}>
					<span className={lab}>
						<Icon name="meeting" size={13} /> {t("heads.who")}
					</span>
					{attendees.map((a) => (
						<span
							key={a}
							className="group flex items-center gap-1 rounded-full bg-tag px-2.5 py-0.5 text-ink2"
						>
							{a}
							<button
								type="button"
								aria-label={t("heads.removePerson", { name: a })}
								onClick={() =>
									removeFromField(
										workspace.index,
										note.id,
										"meeting",
										"attendees",
										a,
									)
								}
								className="text-mute hover:text-ink"
							>
								<Icon name="close" size={10} />
							</button>
						</span>
					))}
					<input
						value={adding}
						aria-label={t("heads.addPerson")}
						placeholder={t("heads.add")}
						onChange={(e) => setAdding(e.target.value)}
						onKeyDown={(e) => {
							if (e.key !== "Enter" || !adding.trim()) return;
							e.preventDefault();
							addToField(
								workspace.index,
								note.id,
								"meeting",
								"attendees",
								adding.trim(),
							);
							setAdding("");
						}}
						className="w-24 bg-transparent outline-none placeholder:text-mute"
					/>
				</div>
			</div>
		</div>
	);
}

/* ---------- Study ---------- */

const CONFIDENCE = ["new", "shaky", "solid"] as const;
const NEXT_DAYS = { new: 1, shaky: 4, solid: 14 } as const;

export function StudyHead({
	note,
	children,
}: {
	note: NoteMeta;
	/** The title field, shown right under the kicker. */
	children?: React.ReactNode;
}) {
	const { t } = useTranslation();
	const confidence = val(note, "study", "confidence") || "new";
	const revisits = list(note, "study", "revisits") as {
		date: string;
		confidence: string;
	}[];
	const record = (c: (typeof CONFIDENCE)[number]) => {
		const today = isoDay(new Date());
		put(note, "study", "confidence", c);
		put(note, "study", "revisitOn", addDays(today, NEXT_DAYS[c]));
		if (c !== confidence || revisits.length === 0)
			addToField(workspace.index, note.id, "study", "revisits", {
				date: today,
				confidence: c,
			});
	};
	return (
		<div className="mb-6 flex flex-col gap-3">
			<div className={kicker}>
				<Icon name="study" size={13} />
				<FieldInput
					note={note}
					kind="study"
					name="subject"
					label={t("heads.subject")}
					placeholder={t("heads.subject")}
					className="font-mono tracking-[0.1em] uppercase"
				/>
			</div>
			{children}
			<div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-ink2">
				<div className="flex items-center gap-1.5">
					<Icon name="link" size={13} className="text-mute" />
					<FieldInput
						note={note}
						kind="study"
						name="source"
						label={t("heads.source")}
						placeholder={t("heads.source")}
						className="w-32"
					/>
					<FieldInput
						note={note}
						kind="study"
						name="sourceUrl"
						label={t("heads.sourceLink")}
						type="url"
						placeholder={t("heads.link")}
						className="w-40"
					/>
				</div>
				<div className="flex items-center gap-1.5">
					<Icon name="history" size={13} className="text-mute" />
					{t("heads.revisit")}
					<FieldInput
						note={note}
						kind="study"
						name="revisitOn"
						label={t("heads.revisitOn")}
						type="date"
					/>
				</div>
				{/* biome-ignore lint/a11y/useSemanticElements: a row of toggle buttons, not a form group */}
				<div role="group" aria-label="Confidence" className="flex gap-1">
					{CONFIDENCE.map((c) => (
						<button
							key={c}
							type="button"
							aria-pressed={confidence === c}
							onClick={() => record(c)}
							className={`rounded-full border px-2.5 py-0.5 capitalize ${confidence === c ? "border-accent bg-accent-soft text-accent" : "border-line hover:bg-hover"}`}
						>
							{t(`heads.confidence.${c}`)}
						</button>
					))}
				</div>
			</div>
		</div>
	);
}

/** The headings of a note, read on this device and re-read when the note is edited. */
interface Heading {
	id: string;
	text: string;
	level: number;
}

function useHeadings(note: NoteMeta) {
	const [heads, setHeads] = useState<Heading[]>([]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: updatedAt moves on every content edit
	useEffect(() => {
		let stale = false;
		const walk = (blocks: Block[]): Heading[] =>
			blocks.flatMap((b) => {
				const text = (Array.isArray(b.content) ? b.content : [])
					.map((c: { text?: string }) => c.text ?? "")
					.join("")
					.trim();
				const own =
					b.type === "heading" && text
						? [
								{
									id: (b as Block & { id: string }).id,
									text,
									level: Number(b.props.level) || 1,
								},
							]
						: [];
				return [...own, ...walk(b.children)];
			});
		void workspace
			.withFragment(note.id, (f: Y.XmlFragment) => walk(fragmentBlocks(f)))
			.then((h) => !stale && setHeads(h));
		return () => {
			stale = true;
		};
	}, [note.id, note.updatedAt]);
	return heads;
}

const jump = (id: string) =>
	document
		.querySelector(`[data-id="${CSS.escape(id)}"]`)
		?.scrollIntoView({ behavior: "smooth", block: "start" });

type Revisit = { date: string; confidence: string };

function Revisits({ revisits }: { revisits: Revisit[] }) {
	const { t } = useTranslation();
	if (revisits.length === 0) return null;
	return (
		<div className="mt-3 rounded-2xl border border-line2 bg-raised p-3 text-xs text-mute xl:mt-0">
			<div className="mb-1 font-medium text-ink2">{t("heads.revisits")}</div>
			{revisits.map((r) => (
				<div key={`${r.date}-${r.confidence}`}>
					{r.date} · {t(`heads.confidence.${r.confidence as "new"}`)}
				</div>
			))}
		</div>
	);
}

/**
 * Study notes: On this page rail beside the note (wide screens), the same list behind a button
 * on phones, and the Revisits box under it.
 */
export function StudyRail({ note }: { note: NoteMeta }) {
	const { t } = useTranslation();
	const heads = useHeadings(note);
	const [open, setOpen] = useState(false);
	const revisits = list(note, "study", "revisits") as Revisit[];
	const items = heads.map((h) => (
		<button
			key={h.id}
			type="button"
			onClick={() => {
				jump(h.id);
				setOpen(false);
			}}
			style={{ paddingInlineStart: `${(h.level - 1) * 12}px` }}
			className="block w-full truncate py-1 text-left text-[13px] text-ink2 hover:text-ink"
		>
			{h.text}
		</button>
	));
	return (
		<>
			<aside
				aria-label={t("heads.onThisPage")}
				className="absolute inset-y-0 left-full ml-8 hidden w-52 xl:block"
			>
				<div className="sticky top-8 flex flex-col gap-5">
					{heads.length > 0 ? (
						<nav>
							<div className="mb-1 text-[11px] font-medium tracking-[0.09em] text-mute uppercase">
								{t("heads.onThisPage")}
							</div>
							{items}
						</nav>
					) : null}
					<Revisits revisits={revisits} />
				</div>
			</aside>
			<div className="relative mb-4 xl:hidden">
				{heads.length > 0 ? (
					<button
						type="button"
						aria-expanded={open}
						onClick={() => setOpen((v) => !v)}
						className="rounded-2xl border border-line px-3 py-1 text-[13px] text-ink2 hover:bg-hover"
					>
						{t("heads.onThisPage")}
					</button>
				) : null}
				{open ? (
					<nav className="absolute top-full left-0 z-20 mt-1 w-64 rounded-2xl border border-line bg-raised p-2 shadow-lg">
						{items}
					</nav>
				) : null}
				<Revisits revisits={revisits} />
			</div>
		</>
	);
}

/* ---------- Today ---------- */

export function TodayHead() {
	const d = new Date();
	return (
		<header className="mb-6">
			<div className={kicker}>
				<span className="font-serif text-[15px] normal-case">今日</span> · Today
			</div>
			<div className="font-serif text-[22px] text-mute">
				{d.toLocaleDateString(dateLocale(), { weekday: "long" })}
			</div>
			<h1 className="font-serif text-[56px] leading-none font-medium tracking-[-0.02em] md:text-[72px]">
				{d.toLocaleDateString(dateLocale(), { day: "numeric", month: "long" })}
			</h1>
		</header>
	);
}
