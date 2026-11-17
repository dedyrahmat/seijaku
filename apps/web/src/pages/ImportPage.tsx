import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { pageLink } from "../components/pageLink";
import {
	type Picked,
	pickedFromDrop,
	pickedFromInput,
} from "../import/archive";
import { ANY_ACCEPT, readSource, SOURCES } from "../import/sources";
import { writeNotes } from "../import/writer";
import { workspace } from "../workspace/store";

interface Row {
	source: string;
	state: "active" | "done" | "warn";
	detail: string;
}

const MAX_ROWS = 300;

/**
 * The mockup's Import boards: choose where the notes come from, drop them in, watch them land.
 * Everything runs on this device. Each source only reads its export into a common shape; one
 * writer makes the pages (see import/writer.ts).
 */
export function ImportPage() {
	const navigate = useNavigate();
	// null means "work it out from what is dropped"; picking a card overrides that.
	const [sourceId, setSourceId] = useState<string | null>(null);
	const chosen = SOURCES.find((s) => s.id === sourceId) ?? null;
	const [sourceName, setSourceName] = useState("your notes");
	const [picked, setPicked] = useState<Picked[]>([]);
	const [dragging, setDragging] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [stage, setStage] = useState<"idle" | "reading" | "writing">("idle");
	const [progress, setProgress] = useState<[number, number]>([0, 0]);
	const [rows, setRows] = useState<Row[]>([]);
	const [stats, setStats] = useState({ images: 0, tags: 0, skipped: 0 });
	const abort = useRef<AbortController | null>(null);
	const background = useRef(false);
	const picker = useRef<HTMLInputElement>(null);
	const folderPicker = useRef<HTMLInputElement>(null);
	const list = useRef<HTMLUListElement>(null);

	useEffect(() => {
		document.title = "Import · Seijaku";
	}, []);

	// Keep the newest row in view as notes land.
	// biome-ignore lint/correctness/useExhaustiveDependencies: rows.length is the trigger
	useEffect(() => {
		list.current?.scrollTo({ top: list.current.scrollHeight });
	}, [rows.length]);

	const take = (list: Picked[]) => {
		setPicked(list);
		setError(list.length === 0 ? "Nothing was found to import there." : null);
	};

	const run = async () => {
		setError(null);
		setRows([]);
		setStats({ images: 0, tags: 0, skipped: 0 });
		background.current = false;
		abort.current = new AbortController();
		const signal = abort.current.signal;
		try {
			setStage("reading");
			const { source, parsed } = await readSource(sourceId, picked);
			setSourceName(source.name);
			if (parsed.notes.length === 0) {
				setError(
					parsed.skipped.length > 0
						? `No notes could be imported. ${parsed.skipped[0]?.reason}.`
						: "No notes were found in what you chose.",
				);
				setStage("idle");
				return;
			}
			setStage("writing");
			setProgress([0, parsed.notes.length]);
			setStats((s) => ({ ...s, skipped: parsed.skipped.length }));
			const tags = new Set<string>();
			const summary = await writeNotes(parsed, {
				signal,
				onStart: (note) =>
					setRows((prev) =>
						[
							...prev,
							{
								source: note.source,
								state: "active" as const,
								detail: "Reading…",
							},
						].slice(-MAX_ROWS),
					),
				onResult: (result, done, total) => {
					setProgress([done, total]);
					for (const t of result.note.tags) tags.add(t.toLowerCase());
					setStats((s) => ({
						images: s.images + result.files,
						tags: tags.size,
						skipped: s.skipped + (result.state === "warn" ? 1 : 0),
					}));
					setRows((prev) => {
						const next = prev.slice();
						let at = next.length - 1;
						while (at >= 0 && next[at]?.source !== result.note.source) at--;
						const row: Row = {
							source: result.note.source,
							state: result.state,
							detail: result.detail,
						};
						if (at >= 0) next[at] = row;
						else next.push(row);
						return next;
					});
				},
			});
			if (signal.aborted) {
				setStage("idle");
				setPicked([]);
				return;
			}
			const first = summary.ids[0];
			const firstNote = workspace.getNotes().find((n) => n.id === first);
			if (!background.current)
				void navigate(
					first ? pageLink(first, firstNote?.title ?? "") : { to: "/" },
				);
			setStage("idle");
			setPicked([]);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Import failed.");
			setStage("idle");
		}
	};

	const busy = stage !== "idle";

	if (busy) {
		const [done, total] = progress;
		const pct = total === 0 ? 0 : Math.round((done / total) * 100);
		return (
			<div className="mx-auto flex w-full max-w-[880px] flex-col gap-6 px-5 pt-10 pb-24 md:px-11">
				<div className="flex flex-col gap-2">
					<h1 className="font-serif text-[32px] font-medium tracking-[-0.015em]">
						{stage === "reading"
							? "Reading your files"
							: `Importing ${sourceName}`}
					</h1>
					<p className="text-[15px] text-ink2">
						You can keep using Seijaku. Imported notes appear in the sidebar as
						they land.
					</p>
				</div>

				<div className="flex flex-col gap-2.5">
					<div className="flex justify-between text-sm">
						<span>
							{stage === "reading"
								? "Opening files…"
								: `${done} of ${total} ${total === 1 ? "note" : "notes"}`}
						</span>
						<span className="text-mute">
							{stage === "reading" ? "" : `${pct}%`}
						</span>
					</div>
					<div
						role="progressbar"
						aria-label="Import progress"
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={pct}
						className="h-2 overflow-hidden rounded-full bg-tag"
					>
						<div
							style={{ width: `${pct}%` }}
							className="h-full rounded-full bg-ink transition-[width]"
						/>
					</div>
					<div className="flex gap-7 pt-1 text-[13px] text-mute">
						<span>
							{stats.images} {stats.images === 1 ? "file" : "files"} saved
						</span>
						<span>
							{stats.tags} {stats.tags === 1 ? "tag" : "tags"} found
						</span>
						<span>
							{stats.skipped} {stats.skipped === 1 ? "thing" : "things"} skipped
						</span>
					</div>
				</div>

				<ul
					ref={list}
					className="flex max-h-[420px] min-h-[96px] flex-col overflow-y-auto rounded-[20px] border border-line bg-raised"
				>
					{rows.map((row, i) => (
						<li
							// biome-ignore lint/suspicious/noArrayIndexKey: sources can repeat across folders
							key={`${row.source}-${i}`}
							className="flex min-h-[46px] items-center gap-3 border-b border-line2 px-[18px] text-sm last:border-b-0"
						>
							<span className="flex size-4 flex-none items-center justify-center">
								{row.state === "done" ? (
									<svg
										width="16"
										height="16"
										viewBox="0 0 16 16"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.6"
										strokeLinecap="round"
										strokeLinejoin="round"
										role="img"
										aria-label="Done"
										className="text-ink2"
									>
										<path d="M3.5 8.5l3 3 6-7" />
									</svg>
								) : null}
								{row.state === "active" ? (
									<svg
										width="16"
										height="16"
										viewBox="0 0 16 16"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.6"
										strokeLinecap="round"
										role="img"
										aria-label="In progress"
									>
										<path d="M8 2.5a5.5 5.5 0 105.5 5.5" />
									</svg>
								) : null}
								{row.state === "warn" ? (
									<svg
										width="16"
										height="16"
										viewBox="0 0 16 16"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.6"
										strokeLinecap="round"
										role="img"
										aria-label="Skipped"
										className="text-accent"
									>
										<path d="M8 4v5M8 11.6v.4" />
									</svg>
								) : null}
							</span>
							<span className="min-w-0 flex-1 truncate font-mono text-[13px]">
								{row.source}
							</span>
							<span
								className={`max-w-[45%] truncate text-xs ${row.state === "warn" ? "text-accent" : "text-mute"}`}
							>
								{row.detail}
							</span>
						</li>
					))}
				</ul>

				<div className="flex flex-wrap items-center gap-3">
					<span className="text-[13px] text-mute">
						Skipped items are listed in a note called “Import report”.
					</span>
					<div className="flex-1" />
					<button
						type="button"
						onClick={() => abort.current?.abort()}
						className="h-11 rounded-[14px] border border-line px-[18px] text-sm text-accent hover:bg-hover md:h-10"
					>
						Cancel import
					</button>
					<button
						type="button"
						onClick={() => {
							background.current = true;
							void navigate({ to: "/" });
						}}
						className="h-11 rounded-[14px] bg-ink px-[22px] text-sm font-medium text-paper hover:opacity-90 md:h-10"
					>
						Keep going in background
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="mx-auto flex w-full max-w-[880px] flex-col gap-[22px] px-5 pt-10 pb-24 md:px-11 md:pt-14">
			<div className="flex flex-col gap-2">
				<h1 className="font-serif text-[32px] font-medium tracking-[-0.015em]">
					Bring your notes with you
				</h1>
				<p className="text-[15px] text-ink2">
					Imports run on this device, so they work offline. Drop your notes in
					and Seijaku works out where they came from, or pick a source below.
				</p>
			</div>

			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{SOURCES.map((s) => {
					const on = s.id === sourceId;
					return (
						<button
							type="button"
							key={s.id}
							aria-pressed={on}
							onClick={() => {
								// Picking the same card again goes back to working it out.
								setSourceId(on ? null : s.id);
								setError(null);
							}}
							className={`flex h-20 items-center gap-3.5 rounded-[20px] border px-4 text-left text-ink ${on ? "border-ink bg-callout" : "border-line bg-raised hover:border-mute"}`}
						>
							<span
								aria-hidden
								className="flex size-[38px] flex-none items-center justify-center rounded-[15px] border border-line bg-paper font-serif text-lg text-ink2"
							>
								{s.mono}
							</span>
							<span className="flex min-w-0 flex-col gap-0.5">
								<span className="text-[15px] font-medium">{s.name}</span>
								<span className="text-xs text-mute">{s.hint}</span>
							</span>
						</button>
					);
				})}
			</div>

			{/* biome-ignore lint/a11y/noStaticElementInteractions: drop target; the buttons inside do the same by keyboard */}
			<div
				onDragOver={(e) => {
					e.preventDefault();
					setDragging(true);
				}}
				onDragLeave={() => setDragging(false)}
				onDrop={(e) => {
					e.preventDefault();
					setDragging(false);
					void pickedFromDrop(e.dataTransfer).then(take);
				}}
				className={`flex min-h-24 flex-col items-center justify-center gap-1.5 rounded-[20px] border-[1.5px] border-dashed px-4 py-6 text-center ${dragging ? "border-ink bg-callout" : "border-line"}`}
			>
				<span className="text-[15px]">
					{picked.length > 0
						? `${picked.length} ${picked.length === 1 ? "file" : "files"} ready`
						: (chosen?.drop ??
							"Drop your notes here: a folder, a .zip or files")}
				</span>
				<span className="flex gap-4">
					<button
						type="button"
						onClick={() => picker.current?.click()}
						className="text-sm underline underline-offset-[3px]"
					>
						or choose a file
					</button>
					{chosen === null || chosen.folder ? (
						<button
							type="button"
							onClick={() => folderPicker.current?.click()}
							className="text-sm underline underline-offset-[3px]"
						>
							or choose a folder
						</button>
					) : null}
				</span>
				<input
					ref={picker}
					type="file"
					multiple
					accept={chosen?.accept ?? ANY_ACCEPT}
					hidden
					onChange={(e) => {
						take(pickedFromInput(e.target.files ?? []));
						e.target.value = "";
					}}
				/>
				<input
					ref={folderPicker}
					type="file"
					// @ts-expect-error: non-standard but supported by every current browser
					webkitdirectory=""
					hidden
					onChange={(e) => {
						take(pickedFromInput(e.target.files ?? []));
						e.target.value = "";
					}}
				/>
			</div>

			{error ? (
				<p role="alert" className="text-sm text-accent">
					{error}
				</p>
			) : null}

			<div className="flex flex-wrap items-center gap-3">
				<span className="text-[13px] text-mute">
					Tags, dates and image embeds are kept where the source has them.
				</span>
				<div className="flex-1" />
				<button
					type="button"
					onClick={() => void navigate({ to: "/" })}
					className="h-11 rounded-[14px] border border-line px-[18px] text-sm text-ink hover:bg-hover md:h-10"
				>
					Cancel
				</button>
				<button
					type="button"
					onClick={() => void run()}
					disabled={picked.length === 0}
					className="h-11 rounded-[14px] bg-ink px-[22px] text-sm font-medium text-paper hover:opacity-90 disabled:opacity-40 md:h-10"
				>
					Continue
				</button>
			</div>
		</div>
	);
}
