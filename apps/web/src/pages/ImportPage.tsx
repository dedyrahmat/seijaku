import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { pageLink } from "../components/pageLink";
import { ACCEPT, importFiles, type SourceKind } from "../import/generic";

interface Source {
	name: string;
	mono: string;
	hint: string;
	/** Generic importers work today; app-specific ones arrive with the importers phase. */
	kind?: SourceKind;
}

const SOURCES: Source[] = [
	{ name: "Obsidian", mono: "O", hint: "Coming soon" },
	{ name: "Notion", mono: "N", hint: "Coming soon" },
	{ name: "Google Keep", mono: "K", hint: "Coming soon" },
	{ name: "Evernote", mono: "E", hint: "Coming soon" },
	{ name: "Apple Notes", mono: "A", hint: "Coming soon" },
	{ name: "Apple Journal", mono: "J", hint: "Coming soon" },
	{ name: "Markdown", mono: "Md", hint: "Files", kind: "markdown" },
	{ name: "HTML", mono: "</>", hint: "Files", kind: "html" },
	{ name: "Plain text", mono: "Tx", hint: ".txt files", kind: "text" },
];

const DROP_TEXT: Record<SourceKind, string> = {
	markdown: "Drop your Markdown files here",
	html: "Drop your HTML files here",
	text: "Drop your text files here",
};

export function ImportPage() {
	const navigate = useNavigate();
	const [kind, setKind] = useState<SourceKind>("markdown");
	const [files, setFiles] = useState<File[]>([]);
	const [dragging, setDragging] = useState(false);
	const [progress, setProgress] = useState<[number, number] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const picker = useRef<HTMLInputElement>(null);

	useEffect(() => {
		document.title = "Import · Seijaku";
	}, []);

	const accepted = (list: File[]) => {
		const exts = ACCEPT[kind].split(",");
		return list.filter((f) =>
			exts.some((e) => f.name.toLowerCase().endsWith(e)),
		);
	};

	const take = (list: File[]) => {
		const ok = accepted(list);
		setFiles(ok);
		setError(
			ok.length === 0 && list.length > 0
				? `None of those files are ${ACCEPT[kind].replaceAll(",", " or ")} files.`
				: null,
		);
	};

	const run = async () => {
		setError(null);
		try {
			setProgress([0, files.length]);
			const ids = await importFiles(files, kind, (d, t) => setProgress([d, t]));
			const first = ids[0];
			if (first)
				void navigate(
					pageLink(first, files[0]?.name.replace(/\.[^.]+$/, "") ?? ""),
				);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Import failed.");
			setProgress(null);
		}
	};

	const busy = progress !== null;

	return (
		<div className="mx-auto flex w-full max-w-[880px] flex-col gap-[22px] px-5 pt-10 pb-24 md:px-11 md:pt-14">
			<div className="flex flex-col gap-2">
				<h1 className="font-serif text-[32px] font-medium tracking-[-0.015em]">
					Bring your notes with you
				</h1>
				<p className="text-[15px] text-ink2">
					Imports run on this device, so they work offline. Pick where your
					notes come from.
				</p>
			</div>

			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{SOURCES.map((s) => {
					const on = s.kind !== undefined && s.kind === kind;
					const disabled = s.kind === undefined;
					return (
						<button
							type="button"
							key={s.name}
							aria-pressed={on}
							disabled={disabled || busy}
							onClick={() => {
								if (s.kind) {
									setKind(s.kind);
									setFiles([]);
									setError(null);
								}
							}}
							className={`flex h-20 items-center gap-3.5 rounded-[20px] border px-4 text-left text-ink disabled:cursor-default ${on ? "border-ink bg-callout" : "border-line bg-raised"} ${disabled ? "opacity-60" : "hover:border-mute"}`}
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

			{/* biome-ignore lint/a11y/noStaticElementInteractions: drop target; the button inside does the same by keyboard */}
			<div
				onDragOver={(e) => {
					e.preventDefault();
					setDragging(true);
				}}
				onDragLeave={() => setDragging(false)}
				onDrop={(e) => {
					e.preventDefault();
					setDragging(false);
					take([...e.dataTransfer.files]);
				}}
				className={`flex min-h-24 flex-col items-center justify-center gap-1.5 rounded-[20px] border-[1.5px] border-dashed px-4 py-6 text-center ${dragging ? "border-ink bg-callout" : "border-line"}`}
			>
				<span className="text-[15px]">
					{files.length > 0
						? `${files.length} ${files.length === 1 ? "file" : "files"} ready`
						: DROP_TEXT[kind]}
				</span>
				<button
					type="button"
					disabled={busy}
					onClick={() => picker.current?.click()}
					className="text-sm underline underline-offset-[3px]"
				>
					or choose files
				</button>
				<input
					ref={picker}
					type="file"
					multiple
					accept={ACCEPT[kind]}
					hidden
					onChange={(e) => {
						take([...(e.target.files ?? [])]);
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
					Each file becomes a page at the top level.
				</span>
				<div className="flex-1" />
				<button
					type="button"
					onClick={() => void navigate({ to: "/" })}
					disabled={busy}
					className="h-11 rounded-[14px] border border-line px-[18px] text-sm text-ink hover:bg-hover md:h-10"
				>
					Cancel
				</button>
				<button
					type="button"
					onClick={() => void run()}
					disabled={files.length === 0 || busy}
					className="h-11 rounded-[14px] bg-ink px-[22px] text-sm font-medium text-paper hover:opacity-90 disabled:opacity-40 md:h-10"
				>
					{progress
						? `Importing ${progress[0]} of ${progress[1]}…`
						: "Continue"}
				</button>
			</div>
		</div>
	);
}
