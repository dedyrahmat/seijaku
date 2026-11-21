import {
	changeKind,
	dailyTitle,
	ensureDailyNote,
	isDailyNoteId,
	type NoteMeta,
	trashNote,
} from "@seijaku/sync";
import {
	Link,
	Outlet,
	useRouter,
	useRouterState,
} from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/session";
import { HistoryPanel, type Preview } from "../components/HistoryPanel";
import { Icon as Glyph } from "../components/Icon";
import { NewNoteDialog } from "../components/NewNoteDialog";
import { NoteFooter } from "../components/NoteFooter";
import { NOTE_TYPES } from "../components/noteKinds";
import { pageLink } from "../components/pageLink";
import { ReadOnlyNote } from "../components/ReadOnlyNote";
import { SharePopover } from "../components/SharePopover";
import { Sidebar } from "../components/Sidebar";
import { Switcher } from "../components/Switcher";
import { SyncStatus } from "../components/SyncStatus";
import { WindowControls } from "../components/WindowControls";
import { isDesktop, isMacDesktop } from "../desktop";
import { exportPage } from "../export";
import { setPref } from "../preferences";
import {
	readLocal,
	useNoteId,
	useNotes,
	useWorkspaceReady,
	writeLocal,
} from "../workspace/hooks";
import { workspace } from "../workspace/store";

const SECTIONS: Record<string, string> = {
	"/trash": "Trash",
	"/import": "Import",
	"/settings": "Settings",
};

/** Screens that stand alone, with no sidebar or title bar: sign-in, capture, public pages. */
const STANDALONE = [
	"/sign-in",
	"/setup",
	"/recovery-phrase",
	"/unlock",
	"/capture",
	"/share/",
];

const SIDEBAR_HIDDEN_KEY = "seijaku:sidebar-hidden";

/** The page and its ancestors, root first. A cycle from concurrent moves cannot loop forever. */
function trail(notes: NoteMeta[], id: string | undefined): NoteMeta[] {
	const out: NoteMeta[] = [];
	const seen = new Set<string>();
	let cur = id ? notes.find((n) => n.id === id) : undefined;
	while (cur && !seen.has(cur.id)) {
		seen.add(cur.id);
		out.unshift(cur);
		const parent: string | null = cur.parentId;
		cur = parent ? notes.find((n) => n.id === parent) : undefined;
	}
	return out;
}

function Icon({ children }: { children: React.ReactNode }) {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.4"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			{children}
		</svg>
	);
}

export function Shell() {
	const ready = useWorkspaceReady();
	const notes = useNotes();
	const router = useRouter();
	const [switcher, setSwitcher] = useState<{
		open: boolean;
		query: string;
		mode: "jump" | "search";
	}>({ open: false, query: "", mode: "jump" });
	const [typing, setTyping] = useState(false);
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [panel, setPanel] = useState<"none" | "history" | "share">("none");
	const [preview, setPreview] = useState<{ id: string; view: Preview } | null>(
		null,
	);
	const [restoring, setRestoring] = useState(false);
	const showPreview = useCallback(
		(id: string | null, view: Preview | null) =>
			setPreview(id && view ? { id, view } : null),
		[],
	);
	const [newNoteOpen, setNewNoteOpen] = useState(false);
	const [sidebarHidden, setSidebarHidden] = useState(
		() => readLocal(SIDEBAR_HIDDEN_KEY) === "1",
	);
	const path = useRouterState({ select: (s) => s.location.pathname });
	const noteId = useNoteId();
	const auth = useAuth();
	const standalone = STANDALONE.some((p) => path.startsWith(p));

	// Signed in but without the notes' key: the only place to be is the unlock screen.
	useEffect(() => {
		if (!standalone && auth.phase === "locked")
			void router.navigate({ to: "/unlock" });
	}, [auth.phase, standalone, router]);

	// Close the mobile drawer after navigating.
	// biome-ignore lint/correctness/useExhaustiveDependencies: path is the trigger
	useEffect(() => {
		setDrawerOpen(false);
	}, [path]);

	// A panel belongs to one page; renaming it rewrites the address but keeps the panel open.
	// biome-ignore lint/correctness/useExhaustiveDependencies: noteId is the trigger
	useEffect(() => {
		setPanel("none");
		setPreview(null);
	}, [noteId]);

	const toggleSidebar = () =>
		setSidebarHidden((v) => {
			writeLocal(SIDEBAR_HIDDEN_KEY, v ? "0" : "1");
			return !v;
		});

	// The shortcuts listed in Settings. Ctrl or Cmd K opens search from anywhere, as the sidebar button promises.
	const latest = useRef({ noteId, toggleSidebar });
	latest.current = { noteId, toggleSidebar };
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
			const key = e.key.toLowerCase();
			const run = (fn: () => void) => {
				e.preventDefault();
				fn();
			};
			if (e.shiftKey && key === "f")
				run(() => setSwitcher({ open: true, query: "", mode: "search" }));
			else if (key === "k")
				run(() => setSwitcher({ open: true, query: "", mode: "jump" }));
			else if (key === "\\") run(() => latest.current.toggleSidebar());
			else if (e.shiftKey && key === "l")
				run(() =>
					setPref(
						"theme",
						document.documentElement.dataset.theme === "dark"
							? "light"
							: "dark",
					),
				);
			else if (e.shiftKey && key === "t")
				run(() => {
					const today = new Date();
					const id = ensureDailyNote(workspace.index, today);
					void router.navigate(pageLink(id, dailyTitle(today)));
				});
			else if (key === "n") run(() => setNewNoteOpen(true));
			else if (e.shiftKey && key === "h" && latest.current.noteId)
				run(() => setPanel((p) => (p === "history" ? "none" : "history")));
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [router]);

	// Typing steps the chrome back; any pointer movement brings it home.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.metaKey || e.ctrlKey || e.altKey || e.key === "Escape") return;
			const el = e.target as HTMLElement | null;
			if (el?.closest(".bn-editor, [data-title]")) setTyping(true);
		};
		const off = () => setTyping(false);
		window.addEventListener("keydown", onKey);
		window.addEventListener("pointermove", off);
		window.addEventListener("pointerdown", off);
		return () => {
			window.removeEventListener("keydown", onKey);
			window.removeEventListener("pointermove", off);
			window.removeEventListener("pointerdown", off);
		};
	}, []);

	if (standalone) return <Outlet />;
	if (auth.phase === "locked")
		return <div className="h-dvh bg-paper" aria-busy="true" />;
	if (!ready) return <div className="h-dvh bg-paper" aria-busy="true" />;

	const sectionPath = path.startsWith("/settings") ? "/settings" : path;
	const crumbs = trail(notes, noteId);
	const current = noteId ? notes.find((n) => n.id === noteId) : undefined;
	const parent = crumbs.length > 1 ? crumbs[crumbs.length - 2] : undefined;
	return (
		<div
			data-typing={typing && !drawerOpen}
			className={`flex h-dvh overflow-hidden bg-paper text-ink ${isMacDesktop ? "pt-7" : ""}`}
		>
			{isMacDesktop ? (
				<div
					data-tauri-drag-region
					className="fixed inset-x-0 top-0 z-50 h-7"
				/>
			) : null}
			<Sidebar
				open={drawerOpen}
				onClose={() => setDrawerOpen(false)}
				hidden={sidebarHidden}
				onSearch={(query = "") => {
					setDrawerOpen(false);
					setSwitcher({ open: true, query, mode: "jump" });
				}}
				onNewNote={() => {
					setDrawerOpen(false);
					setNewNoteOpen(true);
				}}
			/>
			{newNoteOpen ? (
				<NewNoteDialog
					defaultParentId={current?.parentId ?? null}
					onClose={() => setNewNoteOpen(false)}
				/>
			) : null}
			<Switcher
				open={switcher.open}
				initialQuery={switcher.query}
				mode={switcher.mode}
				onClose={() => setSwitcher((s) => ({ ...s, open: false, query: "" }))}
			/>
			<div className="flex min-w-0 flex-1 flex-col">
				{/* Phone: open the drawer. */}
				<header className="chrome flex h-[calc(52px+env(safe-area-inset-top))] items-center gap-0.5 border-b border-line2 bg-panel px-1.5 pt-[env(safe-area-inset-top)] md:hidden">
					<button
						type="button"
						onClick={() => setDrawerOpen(true)}
						className="flex size-11 items-center justify-center rounded-2xl text-ink2 hover:bg-hover"
						aria-label="Open pages"
					>
						<svg
							width="22"
							height="22"
							viewBox="0 0 22 22"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							aria-hidden="true"
						>
							<path d="M4 7h14M4 11h14M4 15h9" />
						</svg>
					</button>
					<span className="min-w-0 flex-1 truncate px-1.5 text-[13px] text-mute">
						{parent ? (
							<Link {...pageLink(parent.id, parent.title)}>
								{parent.title || "Untitled"}
							</Link>
						) : noteId ? null : (
							(SECTIONS[sectionPath] ?? "Seijaku")
						)}
					</span>
					<SyncStatus />
					{current && !current.trashed ? (
						<MoreMenu
							touch
							note={current}
							onHistory={() => setPanel("history")}
							onShare={() => setPanel("share")}
							onTrash={() => trashNote(workspace.index, current.id)}
							onExport={() => void exportPage(current)}
						/>
					) : null}
				</header>

				{/* Desktop: sidebar toggle, breadcrumb, status. */}
				<header
					data-tauri-drag-region
					className={`chrome hidden h-10 flex-none items-center gap-1 border-b border-line2 bg-panel pl-2.5 md:flex ${isDesktop && !isMacDesktop ? "pr-0" : "pr-4"}`}
				>
					<button
						type="button"
						onClick={toggleSidebar}
						aria-label={sidebarHidden ? "Show sidebar" : "Hide sidebar"}
						aria-pressed={!sidebarHidden}
						className="flex h-7 w-8 items-center justify-center rounded-2xl text-ink2 hover:bg-hover"
					>
						<Icon>
							<rect x="2" y="3" width="12" height="10" rx="2" />
							<path d="M6 3v10" />
						</Icon>
					</button>
					<button
						type="button"
						onClick={() => router.history.back()}
						aria-label="Back"
						className="flex size-7 items-center justify-center rounded-2xl text-ink2 hover:bg-hover"
					>
						<Icon>
							<path d="M10 3L5 8l5 5" />
						</Icon>
					</button>
					<button
						type="button"
						onClick={() => router.history.forward()}
						aria-label="Forward"
						className="flex size-7 items-center justify-center rounded-2xl text-ink2 hover:bg-hover"
					>
						<Icon>
							<path d="M6 3l5 5-5 5" />
						</Icon>
					</button>
					<nav
						aria-label="Breadcrumb"
						className="ml-3 flex min-w-0 items-center gap-2 text-[13px] text-ink2"
					>
						{!noteId && SECTIONS[sectionPath] ? (
							<>
								<Link to="/" className="hover:text-ink">
									Seijaku
								</Link>
								<span aria-hidden className="text-mute">
									/
								</span>
								<span className="text-ink" aria-current="page">
									{SECTIONS[sectionPath]}
								</span>
							</>
						) : null}
						{crumbs.map((n, i) => {
							const last = i === crumbs.length - 1;
							return (
								<span key={n.id} className="flex min-w-0 items-center gap-2">
									{i > 0 ? (
										<span aria-hidden className="text-mute">
											/
										</span>
									) : null}
									{last ? (
										<span className="truncate text-ink" aria-current="page">
											{n.title || "Untitled"}
										</span>
									) : (
										<Link
											{...pageLink(n.id, n.title)}
											className="truncate hover:text-ink"
										>
											{n.title || "Untitled"}
										</Link>
									)}
								</span>
							);
						})}
					</nav>
					<div data-tauri-drag-region className="h-full flex-1" />
					<SyncStatus />
					{current && !current.trashed ? (
						<>
							<button
								type="button"
								aria-label="Version history"
								aria-pressed={panel === "history"}
								onClick={() =>
									setPanel(panel === "history" ? "none" : "history")
								}
								className={`flex h-7 w-8 items-center justify-center rounded-2xl text-ink2 hover:bg-hover ${panel === "history" ? "bg-hover" : ""}`}
							>
								<Icon>
									<circle cx="8" cy="8" r="5.5" />
									<path d="M8 5v3l2 1.5" />
								</Icon>
							</button>
							<button
								type="button"
								data-share-trigger
								aria-expanded={panel === "share"}
								onClick={() => setPanel(panel === "share" ? "none" : "share")}
								className={`mx-0.5 flex h-7 items-center gap-1.5 rounded-2xl border border-line px-3 text-[13px] text-ink hover:bg-hover ${panel === "share" ? "bg-hover" : ""}`}
							>
								<Icon>
									<path d="M6.5 9.5l3-3M5 7.5L3.8 8.7a2.5 2.5 0 003.5 3.5L8.5 11M11 8.5l1.2-1.2a2.5 2.5 0 00-3.5-3.5L7.5 5" />
								</Icon>
								Share
							</button>
							<MoreMenu
								note={current}
								onTrash={() => trashNote(workspace.index, current.id)}
								onExport={() => void exportPage(current)}
							/>
						</>
					) : null}
					<WindowControls />
				</header>

				<div className="relative min-h-0 flex-1">
					<main className="h-full overflow-y-auto">
						{preview && panel === "history" ? (
							<>
								<div className="sticky top-0 z-10 flex min-h-[52px] flex-wrap items-center gap-x-4 gap-y-2 border-b border-line2 bg-callout px-6 py-2">
									<span className="text-sm text-ink">
										Previewing {preview.view.label}. Read-only. Your current
										page is unchanged.
									</span>
									<div className="flex-1" />
									<button
										type="button"
										onClick={() => setPreview(null)}
										className="h-[34px] rounded-2xl border border-line px-3.5 text-[13px] text-ink hover:bg-hover"
									>
										Back to current
									</button>
									<button
										type="button"
										disabled={restoring}
										onClick={() => {
											setRestoring(true);
											void preview.view
												.restore()
												.finally(() => setRestoring(false));
										}}
										className="h-[34px] rounded-2xl bg-ink px-4 text-[13px] font-medium text-paper disabled:opacity-40"
									>
										Restore this version
									</button>
								</div>
								<ReadOnlyNote
									title={preview.view.title}
									blocks={preview.view.blocks}
								/>
							</>
						) : (
							<Outlet />
						)}
					</main>
					{current && !current.trashed ? (
						<NoteFooter key={current.id} noteId={current.id} />
					) : null}
				</div>
			</div>
			{panel === "history" && current && !current.trashed ? (
				<HistoryPanel
					noteId={current.id}
					previewId={preview?.id ?? null}
					onPreview={showPreview}
					onClose={() => setPanel("none")}
				/>
			) : null}
			{panel === "share" && current && !current.trashed ? (
				<SharePopover noteId={current.id} onClose={() => setPanel("none")} />
			) : null}
		</div>
	);
}

/** `touch` is the phone header: bigger targets, and History and Share live here because the phone has no room for their buttons. */
function MoreMenu({
	note,
	onTrash,
	onExport,
	touch,
	onHistory,
	onShare,
}: {
	note?: NoteMeta;
	onTrash: () => void;
	onExport: () => void;
	touch?: boolean;
	onHistory?: () => void;
	onShare?: () => void;
}) {
	// Own state: the phone and desktop headers both render one, and a shared flag let the hidden one close the visible menu.
	const [open, setOpen] = useState(false);
	const item = `block w-full rounded-2xl px-3 text-left text-sm hover:bg-hover ${touch ? "py-3" : "py-1.5"}`;
	const root = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) return;
		const close = (e: Event) => {
			if (!root.current?.contains(e.target as Node)) setOpen(false);
		};
		const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
		document.addEventListener("pointerdown", close);
		document.addEventListener("keydown", esc);
		return () => {
			document.removeEventListener("pointerdown", close);
			document.removeEventListener("keydown", esc);
		};
	}, [open]);

	return (
		<div ref={root} className="relative">
			<button
				type="button"
				aria-label="More"
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				className={`flex items-center justify-center text-ink2 hover:bg-hover ${touch ? "size-11 rounded-2xl" : "h-7 w-8 rounded-2xl"}`}
			>
				<svg
					width={touch ? 22 : 16}
					height={touch ? 22 : 16}
					viewBox="0 0 16 16"
					fill="currentColor"
					aria-hidden="true"
				>
					<circle cx="3.5" cy="8" r="1.2" />
					<circle cx="8" cy="8" r="1.2" />
					<circle cx="12.5" cy="8" r="1.2" />
				</svg>
			</button>
			{open ? (
				<div
					role="menu"
					className="absolute top-full right-0 z-50 mt-1 max-h-[80dvh] w-60 overflow-y-auto rounded-2xl border border-line bg-raised p-1 shadow-lg"
				>
					{touch && onHistory ? (
						<button
							type="button"
							role="menuitem"
							onClick={() => {
								onHistory();
								setOpen(false);
							}}
							className={`${item} text-ink`}
						>
							<Glyph name="history" size={15} /> Version history
						</button>
					) : null}
					{touch && onShare ? (
						<button
							type="button"
							role="menuitem"
							onClick={() => {
								onShare();
								setOpen(false);
							}}
							className={`${item} text-ink`}
						>
							<Glyph name="share" size={15} /> Share
						</button>
					) : null}
					{note && !isDailyNoteId(note.id) ? (
						<div className="mb-1 border-b border-line2 pb-1">
							<div className="px-3 pt-2 pb-1 text-[11px] font-medium tracking-[0.09em] text-mute uppercase">
								Change type
							</div>
							{NOTE_TYPES.map((t) => {
								const current = note.kind === t.id;
								const blocked = t.id === "journal" || note.kind === "journal";
								return (
									<button
										key={t.id}
										type="button"
										role="menuitemradio"
										aria-checked={current}
										disabled={blocked && !current}
										onClick={() => {
											changeKind(workspace.index, note.id, t.id);
											setOpen(false);
										}}
										className={`${item} flex items-center gap-2.5 text-ink disabled:opacity-40`}
									>
										<Glyph name={t.id} size={15} />
										<span className="flex-1">{t.name}</span>
										{current ? <Glyph name="check" size={14} /> : null}
									</button>
								);
							})}
							<p className="px-3 pt-1 pb-1.5 text-xs leading-normal text-mute">
								Your writing stays exactly as it is. Only the look and the extra
								fields change.
							</p>
						</div>
					) : null}
					<button
						type="button"
						role="menuitem"
						onClick={() => {
							onExport();
							setOpen(false);
						}}
						className={`${item} text-ink`}
					>
						<Glyph name="export" size={15} /> Export as Markdown
					</button>
					<button
						type="button"
						role="menuitem"
						onClick={() => {
							onTrash();
							setOpen(false);
						}}
						className={`${item} text-accent`}
					>
						<Glyph name="trash" size={15} /> Move to trash
					</button>
				</div>
			) : null}
		</div>
	);
}
