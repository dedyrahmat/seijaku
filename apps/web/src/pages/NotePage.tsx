import {
	isDailyNoteId,
	JOURNAL_ID,
	pageSlug,
	restoreNote,
	updateNote,
} from "@seijaku/sync";
import { Link, Navigate, useNavigate, useParams } from "@tanstack/react-router";
import {
	lazy,
	Suspense,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
	DatabaseKicker,
	DatabaseView,
	RowProps,
} from "../components/DatabaseView";
import {
	ChecklistHead,
	JournalHead,
	JournalMonth,
	MeetingHead,
	PageHead,
	StudyHead,
	StudyRail,
	TodayHead,
} from "../components/heads";
import { LinkedFrom } from "../components/LinkedFrom";
import { NoteMetaRow } from "../components/NoteMetaRow";
import { pageLink, quickLink } from "../components/pageLink";
import { TodayFeeds } from "../components/TodayFeeds";

const Editor = lazy(() =>
	import("../editor/Editor").then((m) => ({ default: m.Editor })),
);

import {
	useNoteId,
	useNoteSession,
	useNotes,
	writeLocal,
} from "../workspace/hooks";
import { workspace } from "../workspace/store";
import { LAST_NOTE_KEY } from "./Home";

export function NotePage() {
	const { t } = useTranslation();
	const noteId = useNoteId() ?? "";
	const { slug } = useParams({ strict: false }) as { slug?: string };
	const navigate = useNavigate();
	const notes = useNotes();
	const note = notes.find((n) => n.id === noteId);
	const session = useNoteSession(noteId);
	const focusEditor = useRef<(() => void) | null>(null);

	useEffect(() => {
		document.title = t("public.title", {
			title: note?.title || t("common.untitled"),
		});
	}, [note?.title, t]);

	useEffect(() => {
		if (note && !note.trashed) writeLocal(LAST_NOTE_KEY, noteId);
	}, [note, noteId]);

	// Keep the address readable: once the title settles, rewrite the URL to match it.
	const title = note?.title;
	useEffect(() => {
		if (title === undefined || !slug || slug === pageSlug(title, noteId))
			return;
		const t = setTimeout(
			() => void navigate({ ...pageLink(noteId, title), replace: true }),
			600,
		);
		return () => clearTimeout(t);
	}, [title, slug, noteId, navigate]);

	if (!note) {
		return (
			<Notice title={t("note.missing")}>
				{t("note.missingDesc")}{" "}
				<Link to="/" className="text-accent underline">
					{t("note.goToPages")}
				</Link>
			</Notice>
		);
	}

	if (note.trashed) {
		return (
			<Notice title={t("note.trashed")}>
				<button
					type="button"
					onClick={() => restoreNote(workspace.index, note.id)}
					className="text-accent underline"
				>
					{t("note.restore")}
				</button>{" "}
				{t("note.toKeepWorking")}
			</Notice>
		);
	}

	// A quick note lives on the wall, as a card.
	if (note.kind === "quick" && !notes.some((n) => n.parentId === note.id))
		return <Navigate {...quickLink(note.id, note.title)} replace />;

	const daily = isDailyNoteId(noteId);
	const kind = daily ? "today" : note.kind;
	// These types draw their own head; the title sits inside it, under the kicker.
	const headed =
		daily || ["journal", "checklist", "meeting", "study"].includes(note.kind);
	const titleField = (
		<TitleField
			key={`title-${noteId}`}
			id={note.id}
			title={note.title}
			onEnter={() => focusEditor.current?.()}
			autoFocus={note.title === ""}
		/>
	);
	return (
		<article
			data-kind={kind}
			className="relative mx-auto w-full max-w-[var(--page-width,760px)] px-5 pt-10 pb-[40vh] md:pt-[72px]"
		>
			{note.kind === "page" && !daily ? <PageHead note={note} /> : null}
			{daily ? <TodayHead /> : null}
			{note.kind === "journal" ? <JournalHead note={note} /> : null}
			{note.kind === "checklist" ? (
				<ChecklistHead note={note}>{titleField}</ChecklistHead>
			) : null}
			{note.kind === "meeting" ? (
				<MeetingHead note={note}>{titleField}</MeetingHead>
			) : null}
			{note.kind === "study" ? (
				<>
					<StudyHead note={note}>{titleField}</StudyHead>
					<StudyRail note={note} />
				</>
			) : null}
			{headed ? null : <DatabaseKicker note={note} notes={notes} />}
			{headed ? null : titleField}
			{note.kind === "database" ? null : <RowProps note={note} notes={notes} />}
			<NoteMetaRow key={`meta-${noteId}`} note={note} />
			{note.kind === "database" ? (
				<DatabaseView db={note} notes={notes} />
			) : null}
			{noteId === JOURNAL_ID ? <JournalMonth /> : null}
			{daily ? <TodayFeeds /> : null}
			{session?.id === noteId ? (
				<Suspense fallback={null}>
					<Editor
						key={`editor-${noteId}`}
						session={session}
						focusRef={focusEditor}
						autoFocus={false}
						sortDone={note.kind === "checklist"}
						owners={
							note.kind === "meeting"
								? (note.fields.meeting?.attendees as string[] | undefined)
								: undefined
						}
					/>
				</Suspense>
			) : null}
			<LinkedFrom noteId={noteId} />
		</article>
	);
}

function TitleField({
	id,
	title,
	onEnter,
	autoFocus,
}: {
	id: string;
	title: string;
	onEnter: () => void;
	autoFocus: boolean;
}) {
	const { t } = useTranslation();
	const [value, setValue] = useState(title);
	const input = useRef<HTMLTextAreaElement>(null);

	// Pick up renames from elsewhere, but never overwrite what is being typed.
	useEffect(() => {
		if (document.activeElement !== input.current) setValue(title);
	}, [title]);

	// A long title wraps onto more lines instead of being cut off.
	// biome-ignore lint/correctness/useExhaustiveDependencies: value is what changes the height
	useLayoutEffect(() => {
		const el = input.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${el.scrollHeight}px`;
	}, [value]);

	return (
		<textarea
			ref={input}
			rows={1}
			data-title
			value={value}
			// A brand-new page opens ready for its title.
			// biome-ignore lint/a11y/noAutofocus: intentional for new, empty pages
			autoFocus={autoFocus}
			placeholder={t("common.untitled")}
			aria-label={t("note.pageTitle")}
			onChange={(e) => {
				// Pasted line breaks become spaces: a title is one line of text, just wrapped.
				const next = e.target.value.replace(/\s*\n\s*/g, " ");
				setValue(next);
				updateNote(workspace.index, id, { title: next });
			}}
			onKeyDown={(e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					// keyCode 229: Safari reports the IME-confirming Enter after isComposing resets
					if (e.nativeEvent.isComposing || e.keyCode === 229) return;
					onEnter();
				}
			}}
			className="mb-4 block w-full resize-none overflow-hidden bg-transparent font-serif text-[42px] leading-[1.12] font-medium tracking-[-0.015em] text-ink outline-none placeholder:text-mute/60 md:text-[68px]"
		/>
	);
}

function Notice({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div className="mx-auto max-w-md px-6 pt-32 text-center">
			<h1 className="font-serif text-2xl">{title}</h1>
			<p className="mt-3 text-mute">{children}</p>
		</div>
	);
}
