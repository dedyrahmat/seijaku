import { useNoteSession, useWordCount } from "../workspace/hooks";

/**
 * Bottom-right of the page: word count and where the text is saved, over a soft fade so
 * the page never ends in a hard edge. Steps back while typing like the rest of the chrome.
 */
export function NoteFooter({ noteId }: { noteId: string }) {
	const session = useNoteSession(noteId);
	const words = useWordCount(session);
	return (
		<>
			<div
				aria-hidden
				className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-[120px] bg-gradient-to-b from-transparent to-paper md:block"
			/>
			<div className="chrome pointer-events-none absolute right-6 bottom-4 hidden gap-4 text-xs text-mute md:flex">
				<span>
					{words.toLocaleString()} {words === 1 ? "word" : "words"}
				</span>
				<span>Saved on this device</span>
			</div>
		</>
	);
}
