import { useEffect, useState } from "react";
import { useNoteSession, useNotes, useWordCount } from "../workspace/hooks";
import { ago } from "./ago";

/**
 * The mockup's "Version history" panel. Snapshots are kept by the server (phase 7), so for now
 * the list holds the one version that exists: the current one, on this device.
 */
export function HistoryPanel({
	noteId,
	onClose,
}: {
	noteId: string;
	onClose: () => void;
}) {
	const note = useNotes().find((n) => n.id === noteId);
	const words = useWordCount(useNoteSession(noteId));
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		const t = setInterval(() => setNow(Date.now()), 30_000);
		const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		window.addEventListener("keydown", esc);
		return () => {
			clearInterval(t);
			window.removeEventListener("keydown", esc);
		};
	}, [onClose]);

	return (
		<aside
			aria-label="Version history"
			className="fixed inset-y-0 right-0 z-40 flex w-80 max-w-[85vw] flex-col border-l border-line2 bg-panel pt-[env(safe-area-inset-top)] shadow-[-8px_0_40px_rgba(40,30,15,0.18)] lg:static lg:max-w-none lg:shadow-none"
		>
			<div className="flex h-[52px] flex-none items-center border-b border-line2 px-5">
				<span className="flex-1 font-serif text-[19px] font-medium">
					History
				</span>
				<button
					type="button"
					onClick={onClose}
					aria-label="Close history"
					className="flex size-11 items-center justify-center rounded-[10px] text-ink2 hover:bg-hover md:size-[30px]"
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.4"
						strokeLinecap="round"
						aria-hidden="true"
					>
						<path d="M3 3l10 10M13 3L3 13" />
					</svg>
				</button>
			</div>
			<div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 py-2">
				<div className="px-2.5 pt-3.5 pb-1.5 text-[11px] font-medium tracking-[0.09em] text-mute uppercase">
					Today
				</div>
				<button
					type="button"
					aria-current="true"
					className="flex w-full flex-col gap-0.5 rounded-[14px] bg-hover px-3 py-2.5 text-left"
				>
					<span className="flex justify-between text-sm font-medium">
						<span>Current</span>
						<span className="text-xs font-normal text-mute">
							{words} {words === 1 ? "word" : "words"}
						</span>
					</span>
					<span className="text-xs text-mute">
						This device · edited {ago(note?.updatedAt ?? null, now)}
					</span>
				</button>
				<p className="px-2.5 pt-4 text-[13px] leading-normal text-mute">
					Earlier versions will appear here once your server is keeping
					snapshots.
				</p>
			</div>
			<p className="border-t border-line2 px-5 pt-3.5 pb-[18px] text-xs leading-[1.55] text-mute">
				Snapshots are kept on your server, thinned out as they age. Restoring
				adds an edit, so it syncs and can be undone.
			</p>
		</aside>
	);
}
