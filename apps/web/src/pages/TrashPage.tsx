import {
	listTrash,
	type NoteMeta,
	purgeAllTrashed,
	purgeNote,
	restoreNote,
} from "@seijaku/sync";
import { useEffect } from "react";
import { useNotes } from "../workspace/hooks";
import { workspace } from "../workspace/store";

/** "today, 08:20", "yesterday", "Thu 12 Nov": how the design words a deletion time. */
function when(ms: number, now = new Date()): string {
	const d = new Date(ms);
	const day = (x: Date) =>
		new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
	const diff = Math.round((day(now) - day(d)) / 86_400_000);
	if (diff === 0)
		return `today, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
	if (diff === 1) return "yesterday";
	return d.toLocaleDateString("en-GB", {
		weekday: "short",
		day: "numeric",
		month: "short",
	});
}

function descendants(notes: NoteMeta[], id: string): number {
	let count = 0;
	const walk = (pid: string) => {
		for (const n of notes) {
			if (n.parentId === pid) {
				count += 1;
				walk(n.id);
			}
		}
	};
	walk(id);
	return count;
}

export function TrashPage() {
	const notes = useNotes();
	const trash = listTrash(notes).sort((a, b) => b.updatedAt - a.updatedAt);

	useEffect(() => {
		document.title = "Trash · Seijaku";
	}, []);

	const forever = (n: NoteMeta, subs: number) => {
		const extra =
			subs > 0 ? ` and its ${subs} sub-${subs === 1 ? "page" : "pages"}` : "";
		if (
			window.confirm(
				`Delete “${n.title || "Untitled"}”${extra} forever? This cannot be undone.`,
			)
		)
			purgeNote(workspace.index, n.id);
	};

	const empty = () => {
		if (
			window.confirm(
				`Delete ${trash.length} ${trash.length === 1 ? "page" : "pages"} forever? This cannot be undone.`,
			)
		)
			purgeAllTrashed(workspace.index);
	};

	return (
		<div className="mx-auto flex w-full max-w-[760px] flex-col gap-7 px-5 pt-10 pb-24 md:pt-[72px]">
			<div className="flex items-end gap-4">
				<div className="flex flex-1 flex-col gap-2">
					<h1 className="font-serif text-[40px] leading-[1.1] font-medium tracking-[-0.015em]">
						Trash
					</h1>
					<p className="text-[15px] text-ink2">
						Deleted pages wait here. Restore one, or remove it for good.
					</p>
				</div>
				{trash.length > 0 ? (
					<button
						type="button"
						onClick={empty}
						className="h-11 shrink-0 rounded-[14px] border border-line px-4 text-[13px] font-medium text-accent hover:bg-hover md:h-9"
					>
						Empty trash
					</button>
				) : null}
			</div>

			{trash.length === 0 ? (
				<p className="border-t border-line2 pt-6 text-[15px] text-mute">
					Nothing here. Pages you delete will wait here first.
				</p>
			) : (
				<ul className="flex flex-col border-t border-line2">
					{trash.map((n) => {
						const parent = notes.find((p) => p.id === n.parentId);
						const subs = descendants(notes, n.id);
						return (
							<li
								key={n.id}
								className="flex min-h-[68px] flex-wrap items-center gap-x-4 gap-y-2 border-b border-line2 py-2.5"
							>
								<div className="flex min-w-0 flex-1 basis-48 flex-col gap-[3px]">
									<span className="truncate text-base font-medium">
										{n.title || "Untitled"}
									</span>
									<span className="text-[13px] text-mute">
										{parent?.title || "Top level"} · deleted {when(n.updatedAt)}
										{subs > 0
											? ` · ${subs} sub-${subs === 1 ? "page" : "pages"}`
											: ""}
									</span>
								</div>
								<button
									type="button"
									onClick={() => restoreNote(workspace.index, n.id)}
									className="h-11 rounded-[14px] border border-line px-3.5 text-[13px] text-ink hover:bg-hover md:h-[34px]"
								>
									Restore
								</button>
								<button
									type="button"
									onClick={() => forever(n, subs)}
									className="h-11 rounded-[10px] px-2.5 text-[13px] text-accent hover:bg-hover md:h-[34px]"
								>
									Delete forever
								</button>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}
