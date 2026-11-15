import { flattenTree } from "@seijaku/sync";
import { Navigate } from "@tanstack/react-router";
import { Logo } from "../components/Logo";
import { pageLink } from "../components/pageLink";
import { useNewPage } from "../components/useNewPage";
import { readLocal, useNotes, useTree } from "../workspace/hooks";

export const LAST_NOTE_KEY = "seijaku:last-note";

export function Home() {
	const notes = useNotes();
	const tree = useTree();
	const newPage = useNewPage();

	const last = readLocal(LAST_NOTE_KEY);
	const target =
		notes.find((n) => n.id === last && !n.trashed) ?? flattenTree(tree)[0];
	if (target) {
		return <Navigate {...pageLink(target.id, target.title)} replace />;
	}

	return (
		<div className="flex h-full flex-col items-center justify-center px-6 text-center">
			<Logo size={128} />
			<h1 className="mt-10 font-serif text-[64px] leading-none font-medium tracking-[-0.01em]">
				Seijaku
			</h1>
			<p
				lang="ja"
				className="mt-3.5 pl-[0.5em] font-serif text-xl tracking-[0.5em] text-mute"
			>
				静寂
			</p>
			<div className="my-12 h-px w-12 bg-line" />
			<p className="font-serif text-2xl text-ink italic">
				Active calm. The opposite of noise.
			</p>
			<p className="mt-3 text-mute">
				Your notes live on this device and sync when you are online.
			</p>
			<button
				type="button"
				onClick={() => newPage(null)}
				className="mt-8 h-11 rounded-[14px] bg-ink px-5 text-sm font-medium text-paper hover:opacity-90"
			>
				Start a page
			</button>
		</div>
	);
}
