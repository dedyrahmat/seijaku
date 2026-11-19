import {
	listTrash,
	type NoteMeta,
	purgeAllTrashed,
	purgeNote,
	restoreNote,
	withoutDescendants,
} from "@seijaku/sync";
import { useEffect, useState } from "react";
import { SelectBox } from "../components/SelectBox";
import { useSelection } from "../components/useSelection";
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
	const sel = useSelection();
	const [confirming, setConfirming] = useState(false);

	useEffect(() => {
		document.title = "Trash · Seijaku";
	}, []);

	useEffect(() => {
		if (!sel.on) return;
		const esc = (e: KeyboardEvent) =>
			e.key === "Escape" && !confirming && sel.stop();
		window.addEventListener("keydown", esc);
		return () => window.removeEventListener("keydown", esc);
	}, [sel.on, sel.stop, confirming]);

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

	// Only pages that are really in the trash list can be ticked; one restored on another device drops out.
	const picked = trash.filter((n) => sel.ids.has(n.id));
	const order = trash.map((n) => n.id);
	const pickedSubs = picked.reduce((n, p) => n + descendants(notes, p.id), 0);
	const count = picked.length;

	const restoreSelected = () => {
		workspace.index.transact(() => {
			for (const id of withoutDescendants(
				notes,
				picked.map((n) => n.id),
			))
				restoreNote(workspace.index, id);
		});
		sel.stop();
	};

	const purgeSelected = () => {
		workspace.index.transact(() => {
			for (const id of withoutDescendants(
				notes,
				picked.map((n) => n.id),
			))
				purgeNote(workspace.index, id);
		});
		setConfirming(false);
		sel.stop();
	};

	return (
		<div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col gap-7 px-5 pt-10 pb-8 md:pt-[72px]">
			<div className="flex items-end gap-4">
				<div className="flex flex-1 flex-col gap-2">
					<h1 className="font-serif text-[40px] leading-[1.1] font-medium tracking-[-0.015em]">
						Trash
					</h1>
					<p className="text-[15px] text-ink2">
						{sel.on
							? "Tick the pages to bring back or remove for good."
							: "Deleted pages wait here. Restore one, or remove it for good."}
					</p>
				</div>
				{trash.length > 0 ? (
					sel.on ? (
						<button
							type="button"
							onClick={() => sel.setAll(order)}
							className="h-11 shrink-0 rounded-2xl border border-line px-4 text-[13px] font-medium text-ink hover:bg-hover md:h-9"
						>
							Select all
						</button>
					) : (
						<div className="flex shrink-0 gap-2">
							<button
								type="button"
								onClick={() => sel.start()}
								className="h-11 rounded-2xl border border-line px-4 text-[13px] font-medium text-ink hover:bg-hover md:h-9"
							>
								Select
							</button>
							<button
								type="button"
								onClick={empty}
								className="h-11 rounded-2xl border border-line px-4 text-[13px] font-medium text-accent hover:bg-hover md:h-9"
							>
								Empty trash
							</button>
						</div>
					)
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
						const ticked = sel.ids.has(n.id);
						const info = (
							<>
								<span className="truncate text-base font-medium">
									{n.title || "Untitled"}
								</span>
								<span className="text-[13px] text-mute">
									{parent?.title || "Top level"} · deleted {when(n.updatedAt)}
									{subs > 0
										? ` · ${subs} sub-${subs === 1 ? "page" : "pages"}`
										: ""}
								</span>
							</>
						);
						return (
							<li key={n.id} className="border-b border-line2">
								{sel.on ? (
									<button
										type="button"
										aria-pressed={ticked}
										onClick={(e) =>
											sel.pick(n.id, order, { range: e.shiftKey })
										}
										className={`flex min-h-[68px] w-full items-center gap-4 px-3 py-2.5 text-left ${ticked ? "bg-callout" : "hover:bg-hover/60"}`}
									>
										<SelectBox on={ticked} />
										<span className="flex min-w-0 flex-1 flex-col gap-[3px]">
											{info}
										</span>
									</button>
								) : (
									<div className="flex min-h-[68px] flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
										<div className="flex min-w-0 flex-1 basis-48 flex-col gap-[3px]">
											{info}
										</div>
										<button
											type="button"
											onClick={() => restoreNote(workspace.index, n.id)}
											className="h-11 rounded-2xl border border-line px-3.5 text-[13px] text-ink hover:bg-hover md:h-[34px]"
										>
											Restore
										</button>
										<button
											type="button"
											onClick={() => forever(n, subs)}
											className="h-11 rounded-2xl px-2.5 text-[13px] text-accent hover:bg-hover md:h-[34px]"
										>
											Delete forever
										</button>
									</div>
								)}
							</li>
						);
					})}
				</ul>
			)}

			{sel.on ? (
				<div
					role="toolbar"
					aria-label="Selected pages"
					className="sticky bottom-6 mt-auto flex flex-wrap items-center gap-2.5 rounded-2xl border border-line bg-raised py-3 pr-3 pl-5 shadow-[0_18px_50px_rgba(40,30,15,0.16),0_2px_6px_rgba(40,30,15,0.08)]"
				>
					<span aria-live="polite" className="flex-1 text-sm font-semibold">
						{count} selected
					</span>
					<button
						type="button"
						disabled={count === 0}
						onClick={restoreSelected}
						className="h-11 rounded-2xl border border-line px-[18px] text-[13px] font-medium text-ink hover:bg-hover disabled:opacity-40 md:h-10"
					>
						Restore {count}
					</button>
					<button
						type="button"
						disabled={count === 0}
						onClick={() => setConfirming(true)}
						className="h-11 rounded-2xl border border-accent px-[18px] text-[13px] font-semibold text-accent hover:bg-hover disabled:opacity-40 md:h-10"
					>
						Delete {count} forever
					</button>
					<button
						type="button"
						onClick={sel.stop}
						className="h-11 rounded-2xl px-3.5 text-[13px] text-ink2 hover:bg-hover md:h-10"
					>
						Cancel
					</button>
				</div>
			) : null}

			{confirming ? (
				<ConfirmDelete
					count={count}
					subs={pickedSubs}
					onKeep={() => setConfirming(false)}
					onDelete={purgeSelected}
				/>
			) : null}
		</div>
	);
}

/** The mockup's "Delete forever, confirm" dialog. */
function ConfirmDelete({
	count,
	subs,
	onKeep,
	onDelete,
}: {
	count: number;
	subs: number;
	onKeep: () => void;
	onDelete: () => void;
}) {
	useEffect(() => {
		const esc = (e: KeyboardEvent) => e.key === "Escape" && onKeep();
		window.addEventListener("keydown", esc);
		return () => window.removeEventListener("keydown", esc);
	}, [onKeep]);

	const pages = `${count} ${count === 1 ? "page" : "pages"}`;
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 p-5">
			<div
				role="alertdialog"
				aria-modal="true"
				aria-labelledby="delete-title"
				className="flex w-[440px] max-w-full flex-col gap-3.5 rounded-2xl border border-line bg-paper p-7 shadow-[0_30px_80px_rgba(40,30,15,0.28),0_2px_8px_rgba(40,30,15,0.1)]"
			>
				<h2
					id="delete-title"
					className="font-serif text-[26px] leading-[1.15] font-medium"
				>
					Delete {pages} forever?
				</h2>
				<p className="text-sm leading-[1.55] text-ink2">
					{count === 1 ? "It" : "They"}
					{subs > 0
						? ` and ${count === 1 ? "its" : "their"} ${subs === 1 ? "sub-page" : `${subs} sub-pages`}`
						: ""}{" "}
					{count === 1 && subs === 0 ? "leaves" : "leave"} every device you use.
					This can’t be undone.
				</p>
				<div className="flex justify-end gap-2.5 pt-1.5">
					<button
						type="button"
						onClick={onKeep}
						className="h-11 rounded-2xl border border-line px-[18px] text-[13px] font-medium text-ink hover:bg-hover md:h-10"
					>
						Keep them
					</button>
					<button
						type="button"
						onClick={onDelete}
						className="h-11 rounded-2xl bg-accent px-5 text-[13px] font-semibold text-paper md:h-10"
					>
						Delete {count} forever
					</button>
				</div>
			</div>
		</div>
	);
}
