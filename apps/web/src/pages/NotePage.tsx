import {
	isDailyNoteId,
	pageSlug,
	restoreNote,
	updateNote,
} from "@seijaku/sync";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { NoteMetaRow } from "../components/NoteMetaRow";
import { pageLink } from "../components/pageLink";

const Editor = lazy(() =>
	import("../editor/Editor").then((m) => ({ default: m.Editor })),
);
// Reads note content through the editor's converters, so it loads on demand like the editor.
const StillToDo = lazy(() =>
	import("../components/StillToDo").then((m) => ({ default: m.StillToDo })),
);

/** A quick note has no title field of its own: its first line names it once you leave. */
async function nameFromFirstLine(id: string) {
	const note = workspace.getNotes().find((n) => n.id === id);
	if (!note || note.trashed || note.title !== "") return;
	const first = (await workspace.readText(id))
		.split("\n")
		.find((line) => line.trim());
	if (first)
		updateNote(workspace.index, id, { title: first.trim().slice(0, 80) });
}

import {
	useNoteId,
	useNoteSession,
	useNotes,
	writeLocal,
} from "../workspace/hooks";
import { workspace } from "../workspace/store";
import { LAST_NOTE_KEY } from "./Home";

export function NotePage() {
	const noteId = useNoteId() ?? "";
	const { slug } = useParams({ strict: false }) as { slug?: string };
	const navigate = useNavigate();
	const note = useNotes().find((n) => n.id === noteId);
	const session = useNoteSession(noteId);
	const focusEditor = useRef<(() => void) | null>(null);

	useEffect(() => {
		document.title = `${note?.title || "Untitled"} · Seijaku`;
	}, [note?.title]);

	useEffect(() => {
		if (note && !note.trashed) writeLocal(LAST_NOTE_KEY, noteId);
	}, [note, noteId]);

	const isQuick = note?.kind === "quick";
	useEffect(() => {
		if (!isQuick) return;
		return () => void nameFromFirstLine(noteId);
	}, [isQuick, noteId]);

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
			<Notice title="This page isn't here">
				It may have been deleted on another device.{" "}
				<Link to="/" className="text-accent underline">
					Go to your pages
				</Link>
			</Notice>
		);
	}

	if (note.trashed) {
		return (
			<Notice title="This page is in the trash">
				<button
					type="button"
					onClick={() => restoreNote(workspace.index, note.id)}
					className="text-accent underline"
				>
					Restore it
				</button>{" "}
				to keep working on it.
			</Notice>
		);
	}

	return (
		<article className="mx-auto w-full max-w-[var(--page-width,760px)] px-5 pt-10 pb-[40vh] md:pt-[72px]">
			<TitleField
				key={`title-${noteId}`}
				id={note.id}
				title={note.title}
				onEnter={() => focusEditor.current?.()}
				// A new quick note opens in its body, not on a title.
				autoFocus={note.title === "" && !isQuick}
			/>
			<NoteMetaRow key={`meta-${noteId}`} note={note} />
			{isDailyNoteId(noteId) ? (
				<Suspense fallback={null}>
					<StillToDo />
				</Suspense>
			) : null}
			{session?.id === noteId ? (
				<Suspense fallback={null}>
					<Editor
						key={`editor-${noteId}`}
						session={session}
						focusRef={focusEditor}
						autoFocus={note.title === "" && isQuick}
					/>
				</Suspense>
			) : null}
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
	const [value, setValue] = useState(title);
	const input = useRef<HTMLInputElement>(null);

	// Pick up renames from elsewhere, but never overwrite what is being typed.
	useEffect(() => {
		if (document.activeElement !== input.current) setValue(title);
	}, [title]);

	return (
		<input
			ref={input}
			data-title
			value={value}
			// A brand-new page opens ready for its title.
			// biome-ignore lint/a11y/noAutofocus: intentional for new, empty pages
			autoFocus={autoFocus}
			placeholder="Untitled"
			aria-label="Page title"
			onChange={(e) => {
				setValue(e.target.value);
				updateNote(workspace.index, id, { title: e.target.value });
			}}
			onKeyDown={(e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					// keyCode 229: Safari reports the IME-confirming Enter after isComposing resets
					if (e.nativeEvent.isComposing || e.keyCode === 229) return;
					onEnter();
				}
			}}
			className="mb-4 w-full bg-transparent font-serif text-[42px] leading-[1.12] font-medium tracking-[-0.015em] text-ink outline-none placeholder:text-mute/60 md:text-[68px]"
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
