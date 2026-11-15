import { pageSlug, restoreNote, updateNote } from "@seijaku/sync";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { pageLink } from "../components/pageLink";
import { Editor } from "../editor/Editor";
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
		<article className="mx-auto w-full max-w-[760px] px-5 pt-10 pb-[40vh] md:pt-[72px]">
			<TitleField
				key={`title-${noteId}`}
				id={note.id}
				title={note.title}
				onEnter={() => focusEditor.current?.()}
			/>
			{session?.id === noteId ? (
				<Editor
					key={`editor-${noteId}`}
					session={session}
					focusRef={focusEditor}
				/>
			) : null}
		</article>
	);
}

function TitleField({
	id,
	title,
	onEnter,
}: {
	id: string;
	title: string;
	onEnter: () => void;
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
			autoFocus={title === ""}
			placeholder="Untitled"
			aria-label="Page title"
			onChange={(e) => {
				setValue(e.target.value);
				updateNote(workspace.index, id, { title: e.target.value });
			}}
			onKeyDown={(e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					onEnter();
				}
			}}
			className="mb-6 w-full bg-transparent font-serif text-[42px] leading-[1.12] font-medium tracking-[-0.015em] text-ink outline-none placeholder:text-mute/60 md:text-[68px]"
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
