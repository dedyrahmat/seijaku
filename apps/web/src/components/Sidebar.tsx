import {
	buildTree,
	dailyNoteId,
	dailyTitle,
	ensureDailyNote,
	isDailyNoteId,
	listTags,
	moveNote,
	type NoteMeta,
	type Nudge,
	nudgeNote,
	siblingsOf,
	type TreeNode,
	trashNote,
	withoutDescendants,
} from "@seijaku/sync";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { readLocal, useNoteId, useNotes, writeLocal } from "../workspace/hooks";
import { workspace } from "../workspace/store";
import { Logo } from "./Logo";
import { pageLink } from "./pageLink";
import { SelectBox } from "./SelectBox";
import { useNewPage } from "./useNewPage";
import { useSelection } from "./useSelection";

const EXPANDED_KEY = "seijaku:expanded";

function loadExpanded(): Set<string> {
	try {
		const raw = readLocal(EXPANDED_KEY);
		return new Set(raw ? (JSON.parse(raw) as string[]) : []);
	} catch {
		return new Set();
	}
}

type Zone = "before" | "after" | "into";

interface TreeCtx {
	activeId: string | undefined;
	expanded: Set<string>;
	toggle: (id: string, force?: boolean) => void;
	dragId: React.MutableRefObject<string | null>;
	addChild: (parentId: string) => void;
	/** "Select pages" mode, and the rows in the order they are on screen (for Shift ranges). */
	sel: ReturnType<typeof useSelection>;
	order: string[];
}

export function Sidebar({
	open,
	onClose,
	hidden = false,
	onSearch,
	onNewNote,
}: {
	open: boolean;
	onClose: () => void;
	/** Desktop only: the sidebar is collapsed from the top bar. */
	hidden?: boolean;
	/** Opens the quick switcher, optionally with a query already typed. */
	onSearch: (query?: string) => void;
	/** Opens the "New note" picker. */
	onNewNote: () => void;
}) {
	const notes = useNotes();
	const newPage = useNewPage();
	const noteId = useNoteId();
	const navigate = useNavigate();
	const path = useRouterState({ select: (s) => s.location.pathname });
	const [expanded, setExpanded] = useState(loadExpanded);
	const dragId = useRef<string | null>(null);

	// Daily notes live behind "Today", not in the page tree.
	const tree = useMemo(
		() => buildTree(notes.filter((n) => !isDailyNoteId(n.id))),
		[notes],
	);
	const tags = useMemo(() => listTags(notes), [notes]);
	const today = new Date();
	const todayId = dailyNoteId(today);
	const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

	const toggle = (id: string, force?: boolean) =>
		setExpanded((prev) => {
			const next = new Set(prev);
			const want = force ?? !next.has(id);
			if (want) next.add(id);
			else next.delete(id);
			writeLocal(EXPANDED_KEY, JSON.stringify([...next]));
			return next;
		});

	const sel = useSelection();
	const order = useMemo(() => {
		const out: string[] = [];
		const walk = (nodes: TreeNode[]) => {
			for (const n of nodes) {
				out.push(n.note.id);
				if (expanded.has(n.note.id)) walk(n.children);
			}
		};
		walk(tree);
		return out;
	}, [tree, expanded]);

	useEffect(() => {
		if (!sel.on) return;
		const esc = (e: KeyboardEvent) => e.key === "Escape" && sel.stop();
		window.addEventListener("keydown", esc);
		return () => window.removeEventListener("keydown", esc);
	}, [sel.on, sel.stop]);

	const trashSelected = () => {
		const ids = withoutDescendants(notes, sel.ids);
		workspace.index.transact(() => {
			for (const id of ids) trashNote(workspace.index, id);
		});
		// The open page may be one of them, or sit under one: leave it.
		const gone = new Set(ids);
		const byId = new Map(notes.map((n) => [n.id, n]));
		let cur = noteId;
		for (let hops = 0; cur && hops < 100; hops++) {
			if (gone.has(cur)) {
				void navigate({ to: "/" });
				break;
			}
			cur = byId.get(cur)?.parentId ?? undefined;
		}
		sel.stop();
	};

	const ctx: TreeCtx = {
		activeId: noteId,
		expanded,
		toggle,
		dragId,
		addChild: (parentId) => {
			toggle(parentId, true);
			newPage(parentId);
		},
		sel,
		order,
	};

	const openToday = () => {
		const id = ensureDailyNote(workspace.index, today);
		void navigate(pageLink(id, dailyTitle(today)));
	};

	const foot =
		"flex h-11 w-full items-center gap-2.5 rounded-2xl px-2.5 text-left text-[13px] text-ink2 hover:bg-hover md:h-8";

	return (
		<>
			{open ? (
				<button
					type="button"
					aria-label="Close pages"
					onClick={onClose}
					className="fixed inset-0 z-30 bg-ink/30 md:hidden"
				/>
			) : null}
			<aside
				aria-label="Pages"
				className={`chrome fixed inset-y-0 left-0 z-40 flex w-[326px] max-w-[85vw] flex-col border-r border-line2 bg-panel pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-[8px_0_40px_rgba(40,30,15,0.22)] transition-transform duration-200 md:static md:w-[264px] md:max-w-none md:translate-x-0 md:shadow-none ${open ? "translate-x-0" : "-translate-x-full"} ${hidden ? "md:hidden" : ""}`}
			>
				{sel.on ? (
					<SelectHeader
						onAll={() => sel.setAll(order)}
						hint="Tick the pages you want to move. You can bring them back from Trash."
					/>
				) : (
					<>
						<div className="flex h-14 flex-none items-center gap-2.5 pr-3.5 pl-[18px]">
							<Link to="/" className="flex items-center gap-2.5">
								<Logo size={24} />
								<span className="font-serif text-xl font-medium tracking-[0.01em]">
									Seijaku
								</span>
							</Link>
							<div className="flex-1" />
							<button
								type="button"
								onClick={onNewNote}
								aria-label="New page"
								className="flex size-11 items-center justify-center rounded-2xl text-ink2 hover:bg-hover md:size-8"
							>
								<svg
									width="16"
									height="16"
									viewBox="0 0 16 16"
									fill="none"
									stroke="currentColor"
									strokeWidth="1.4"
									strokeLinecap="round"
									aria-hidden="true"
								>
									<path d="M8 3v10M3 8h10" />
								</svg>
							</button>
						</div>

						<div className="flex-none px-2.5 pt-1 pb-2.5">
							<button
								type="button"
								onClick={() => onSearch()}
								className="flex h-11 w-full items-center gap-2.5 rounded-2xl border border-line bg-raised px-2.5 text-left text-[13px] text-ink2 hover:border-mute md:h-9"
							>
								<svg
									width="15"
									height="15"
									viewBox="0 0 16 16"
									fill="none"
									stroke="currentColor"
									strokeWidth="1.4"
									strokeLinecap="round"
									aria-hidden="true"
								>
									<circle cx="7" cy="7" r="4.5" />
									<path d="M10.5 10.5L14 14" />
								</svg>
								<span className="flex-1">Search or jump to</span>
								<span className="hidden font-mono text-[11px] text-mute md:inline">
									{isMac ? "⌘ K" : "Ctrl K"}
								</span>
							</button>
						</div>

						<div className="flex-none px-2.5">
							<button
								type="button"
								onClick={openToday}
								aria-current={noteId === todayId ? "page" : undefined}
								className={`flex h-11 w-full items-center gap-2.5 rounded-2xl px-2.5 text-left text-sm text-ink hover:bg-hover md:h-[34px] ${noteId === todayId ? "bg-hover" : ""}`}
							>
								<svg
									width="15"
									height="15"
									viewBox="0 0 16 16"
									fill="none"
									stroke="currentColor"
									strokeWidth="1.4"
									strokeLinecap="round"
									strokeLinejoin="round"
									className="text-ink2"
									aria-hidden="true"
								>
									<rect x="2.5" y="3.5" width="11" height="10" rx="2" />
									<path d="M2.5 7h11M5.5 2v3M10.5 2v3" />
								</svg>
								<span className="flex-1">Today</span>
								<span className="text-xs text-mute">{dailyTitle(today)}</span>
							</button>
						</div>
					</>
				)}

				<div className="px-5 pt-4 pb-1.5 text-[11px] font-medium tracking-[0.09em] text-mute uppercase">
					Pages
				</div>

				<nav className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
					{tree.length === 0 ? (
						<p className="px-2 py-2 text-sm text-mute">No pages yet.</p>
					) : (
						<ul className="flex flex-col gap-px">
							{tree.map((node) => (
								<TreeRow key={node.note.id} node={node} depth={0} ctx={ctx} />
							))}
						</ul>
					)}

					{tags.length > 0 && !sel.on ? (
						<div className="hidden md:block">
							<div className="px-2.5 pt-[18px] pb-1.5 text-[11px] font-medium tracking-[0.09em] text-mute uppercase">
								Tags
							</div>
							<div className="flex flex-wrap gap-x-3.5 gap-y-1 px-2.5 text-[13px] text-ink2">
								{tags.map(({ tag }) => (
									<button
										type="button"
										key={tag}
										onClick={() => onSearch(`#${tag}`)}
										className="hover:text-ink"
									>
										#{tag}
									</button>
								))}
							</div>
						</div>
					) : null}
				</nav>

				{sel.on ? (
					<SelectBar
						count={withoutDescendants(notes, sel.ids).length}
						onTrash={trashSelected}
						onCancel={sel.stop}
					/>
				) : (
					<div className="flex flex-none flex-col gap-px border-t border-line2 px-2.5 pt-2 pb-3">
						<Link
							to="/trash"
							className={`${foot} ${path === "/trash" ? "bg-hover" : ""}`}
						>
							<FootIcon>
								<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.2c0 .5.4.8.9.8h4c.5 0 .9-.3.9-.8l.6-8.2" />
							</FootIcon>
							Trash
						</Link>
						<Link
							to="/import"
							className={`${foot} ${path === "/import" ? "bg-hover" : ""}`}
						>
							<FootIcon>
								<path d="M8 2.5v8M4.8 7.6L8 10.8l3.2-3.2M3 13h10" />
							</FootIcon>
							Import
						</Link>
						<Link
							to="/settings"
							className={`${foot} ${path.startsWith("/settings") ? "bg-hover" : ""}`}
						>
							<FootIcon>
								<path d="M2.5 5h6M12 5h1.5M2.5 11h1.5M7.5 11h6" />
								<circle cx="10" cy="5" r="1.6" />
								<circle cx="5.7" cy="11" r="1.6" />
							</FootIcon>
							Settings
						</Link>
					</div>
				)}
			</aside>
		</>
	);
}

/** The mockup's "Sidebar · Select" top: a title, a plain-words hint and Select all. */
function SelectHeader({ onAll, hint }: { onAll: () => void; hint: string }) {
	return (
		<>
			<div className="flex h-14 flex-none items-center gap-2.5 pr-3 pl-5">
				<span className="flex-1 font-serif text-xl font-medium">
					Select pages
				</span>
				<button
					type="button"
					onClick={onAll}
					className="h-11 rounded-2xl px-3 text-[13px] font-medium text-ink underline underline-offset-[3px] hover:bg-hover md:h-8"
				>
					Select all
				</button>
			</div>
			<p className="flex-none px-5 pb-2.5 text-[13px] leading-normal text-mute">
				{hint}
			</p>
		</>
	);
}

/** The bar at the foot of the sidebar while selecting: how many, move to trash, cancel. */
function SelectBar({
	count,
	onTrash,
	onCancel,
}: {
	count: number;
	onTrash: () => void;
	onCancel: () => void;
}) {
	return (
		<div className="flex-none border-t border-line2 p-3">
			<div className="flex flex-col gap-3 rounded-2xl border border-line bg-raised p-3.5">
				<div className="flex flex-col gap-0.5">
					<span aria-live="polite" className="text-sm font-semibold">
						{count} {count === 1 ? "page" : "pages"} selected
					</span>
					<span className="hidden text-xs text-mute md:inline">
						Shift-click picks a range.
					</span>
				</div>
				<div className="flex gap-2">
					<button
						type="button"
						onClick={onTrash}
						disabled={count === 0}
						className="h-11 flex-1 rounded-2xl border border-accent px-2.5 text-[13px] font-semibold text-accent hover:bg-hover disabled:opacity-40 md:h-[38px]"
					>
						Move to trash
					</button>
					<button
						type="button"
						onClick={onCancel}
						className="h-11 rounded-2xl border border-line px-4 text-[13px] font-medium text-ink hover:bg-hover md:h-[38px]"
					>
						Cancel
					</button>
				</div>
			</div>
		</div>
	);
}

function FootIcon({ children }: { children: React.ReactNode }) {
	return (
		<svg
			width="15"
			height="15"
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

function TreeRow({
	node,
	depth,
	ctx,
}: {
	node: TreeNode;
	depth: number;
	ctx: TreeCtx;
}) {
	const { note, children } = node;
	const [zone, setZone] = useState<Zone | null>(null);
	const isOpen = ctx.expanded.has(note.id);
	const active = ctx.activeId === note.id;
	const ticked = ctx.sel.on && ctx.sel.ids.has(note.id);

	const onDragOver = (e: React.DragEvent) => {
		if (!ctx.dragId.current || ctx.dragId.current === note.id) return;
		e.preventDefault();
		const r = e.currentTarget.getBoundingClientRect();
		const y = (e.clientY - r.top) / r.height;
		setZone(y < 0.28 ? "before" : y > 0.72 ? "after" : "into");
	};

	const onDrop = (e: React.DragEvent) => {
		e.preventDefault();
		const dragged = ctx.dragId.current;
		const z = zone;
		setZone(null);
		ctx.dragId.current = null;
		if (!dragged || !z || dragged === note.id) return;

		if (z === "into") {
			if (moveNote(workspace.index, dragged, note.id, null))
				ctx.toggle(note.id, true);
		} else if (z === "before") {
			moveNote(workspace.index, dragged, note.parentId, note.id);
		} else {
			const sibs = siblingsOf(workspace.getNotes(), note.parentId).filter(
				(n) => n.id !== dragged,
			);
			const i = sibs.findIndex((n) => n.id === note.id);
			moveNote(
				workspace.index,
				dragged,
				note.parentId,
				sibs[i + 1]?.id ?? null,
			);
		}
	};

	return (
		<li>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: drag is a pointer shortcut; the row menu offers the same moves by keyboard and touch */}
			<div
				draggable={!ctx.sel.on}
				onDragStart={(e) => {
					ctx.dragId.current = note.id;
					e.dataTransfer.effectAllowed = "move";
					e.dataTransfer.setData("text/plain", note.id);
				}}
				onDragEnd={() => {
					ctx.dragId.current = null;
					setZone(null);
				}}
				onDragOver={onDragOver}
				onDragLeave={() => setZone(null)}
				onDrop={onDrop}
				style={{ paddingLeft: 2 + depth * 16 }}
				className={`row group flex items-center rounded-2xl ${active || ticked ? "bg-hover" : "hover:bg-hover/60"} ${zone ? `drop-${zone}` : ""}`}
			>
				{children.length > 0 ? (
					<button
						type="button"
						onClick={() => ctx.toggle(note.id)}
						aria-label={isOpen ? "Collapse" : "Expand"}
						aria-expanded={isOpen}
						className="flex h-8 w-6 shrink-0 items-center justify-center text-mute hover:text-ink"
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							strokeLinejoin="round"
							aria-hidden="true"
							className={`transition-transform ${isOpen ? "rotate-90" : ""}`}
						>
							<path d="M6 3.5l4.5 4.5L6 12.5" />
						</svg>
					</button>
				) : (
					<span className="w-6 shrink-0" />
				)}
				{ctx.sel.on ? (
					<button
						type="button"
						aria-pressed={ticked}
						onClick={(e) =>
							ctx.sel.pick(note.id, ctx.order, { range: e.shiftKey })
						}
						className={`flex min-h-11 min-w-0 flex-1 items-center gap-2.5 py-1 pl-1 text-left text-sm md:min-h-8 ${ticked ? "font-medium text-ink" : "text-ink2"}`}
					>
						<SelectBox on={ticked} />
						<span className="truncate">{note.title || "Untitled"}</span>
					</button>
				) : (
					<>
						<Link
							{...pageLink(note.id, note.title)}
							aria-current={active ? "page" : undefined}
							onClick={(e) => {
								// A keyboard way in: Ctrl/Cmd-click or Shift-click starts selecting.
								if (e.ctrlKey || e.metaKey || e.shiftKey) {
									e.preventDefault();
									ctx.sel.start(note.id);
								}
							}}
							className={`min-w-0 flex-1 truncate py-2.5 text-sm md:py-[7px] ${active ? "font-medium text-ink" : "text-ink2"}`}
						>
							{note.title || "Untitled"}
						</Link>
						<RowMenu note={note} ctx={ctx} />
					</>
				)}
			</div>
			{isOpen && children.length > 0 ? (
				<ul>
					{children.map((c) => (
						<TreeRow key={c.note.id} node={c} depth={depth + 1} ctx={ctx} />
					))}
				</ul>
			) : null}
		</li>
	);
}

function RowMenu({ note, ctx }: { note: NoteMeta; ctx: TreeCtx }) {
	const [open, setOpen] = useState(false);
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

	const nudge = (dir: Nudge) => {
		// Indenting tucks the page under the one above it; open that page so the result is visible.
		const newParent =
			dir === "indent"
				? siblingsOf(workspace.getNotes(), note.parentId)
						.filter((n) => !isDailyNoteId(n.id))
						.find((_, i, all) => all[i + 1]?.id === note.id)
				: undefined;
		if (nudgeNote(workspace.index, note.id, dir) && newParent) {
			ctx.toggle(newParent.id, true);
		}
		setOpen(false);
	};

	// Say what each move does in terms of the pages around it, and leave out moves that would do nothing.
	const items: { label: string; run: () => void; danger?: boolean }[] = [];
	if (open) {
		const all = workspace.getNotes();
		const sibs = siblingsOf(all, note.parentId).filter(
			(n) => !isDailyNoteId(n.id),
		);
		const i = sibs.findIndex((n) => n.id === note.id);
		const above = sibs[i - 1];
		const parent = all.find((n) => n.id === note.parentId);
		const name = (n: NoteMeta) => `“${n.title || "Untitled"}”`;
		items.push({
			label: "Add a page inside",
			run: () => ctx.addChild(note.id),
		});
		if (above) items.push({ label: "Move up", run: () => nudge("up") });
		if (i >= 0 && i < sibs.length - 1)
			items.push({ label: "Move down", run: () => nudge("down") });
		if (above)
			items.push({
				label: `Put inside ${name(above)}`,
				run: () => nudge("indent"),
			});
		if (parent)
			items.push({
				label: `Move out of ${name(parent)}`,
				run: () => nudge("outdent"),
			});
		items.push({ label: "Select pages", run: () => ctx.sel.start(note.id) });
		items.push({
			label: "Move to trash",
			run: () => trashNote(workspace.index, note.id),
			danger: true,
		});
	}

	return (
		<div ref={root} className="relative">
			<button
				type="button"
				aria-label={`Actions for ${note.title || "Untitled"}`}
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
				data-open={open}
				className="row-actions flex h-8 w-8 items-center justify-center rounded-2xl text-mute hover:text-ink"
			>
				<span aria-hidden>⋯</span>
			</button>
			{open ? (
				<div
					role="menu"
					className="absolute top-full right-0 z-50 mt-1 w-60 rounded-2xl border border-line bg-raised p-1 shadow-lg"
				>
					{items.map((item) => (
						<div key={item.label}>
							{item.danger ? (
								<div className="mx-2 my-1 border-t border-line2" />
							) : null}
							<button
								type="button"
								role="menuitem"
								title={item.label}
								onClick={() => {
									item.run();
									setOpen(false);
								}}
								className={`block w-full truncate rounded-2xl px-3 py-2.5 text-left text-sm hover:bg-hover md:py-1.5 ${item.danger ? "text-accent" : "text-ink"}`}
							>
								{item.label}
							</button>
						</div>
					))}
				</div>
			) : null}
		</div>
	);
}
