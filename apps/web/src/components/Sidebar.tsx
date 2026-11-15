import {
	listTrash,
	moveNote,
	type NoteMeta,
	type Nudge,
	nudgeNote,
	restoreNote,
	siblingsOf,
	type TreeNode,
	trashNote,
} from "@seijaku/sync";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
	readLocal,
	useNoteId,
	useNotes,
	useTree,
	writeLocal,
} from "../workspace/hooks";
import { workspace } from "../workspace/store";
import { Logo } from "./Logo";
import { pageLink } from "./pageLink";
import { useNewPage } from "./useNewPage";

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
}

export function Sidebar({
	open,
	onClose,
	hidden = false,
}: {
	open: boolean;
	onClose: () => void;
	/** Desktop only: the sidebar is collapsed from the top bar. */
	hidden?: boolean;
}) {
	const tree = useTree();
	const notes = useNotes();
	const newPage = useNewPage();
	const noteId = useNoteId();
	const [expanded, setExpanded] = useState(loadExpanded);
	const dragId = useRef<string | null>(null);
	const [showTrash, setShowTrash] = useState(false);
	const trash = listTrash(notes);

	const toggle = (id: string, force?: boolean) =>
		setExpanded((prev) => {
			const next = new Set(prev);
			const want = force ?? !next.has(id);
			if (want) next.add(id);
			else next.delete(id);
			writeLocal(EXPANDED_KEY, JSON.stringify([...next]));
			return next;
		});

	const ctx: TreeCtx = {
		activeId: noteId,
		expanded,
		toggle,
		dragId,
		addChild: (parentId) => {
			toggle(parentId, true);
			newPage(parentId);
		},
	};

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
				className={`chrome fixed inset-y-0 left-0 z-40 flex w-72 max-w-[85vw] flex-col border-r border-line2 bg-panel pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] transition-transform duration-200 md:static md:w-[264px] md:max-w-none md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"} ${hidden ? "md:hidden" : ""}`}
			>
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
						onClick={() => newPage(null)}
						aria-label="New page"
						className="flex size-9 items-center justify-center rounded-[10px] text-ink2 hover:bg-hover md:size-8"
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

				<div className="px-5 pt-4 pb-1.5 text-[11px] font-medium tracking-[0.09em] text-mute uppercase">
					Pages
				</div>

				<nav className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
					{tree.length === 0 ? (
						<p className="px-2 py-2 text-sm text-mute">No pages yet.</p>
					) : (
						<ul>
							{tree.map((node) => (
								<TreeRow key={node.note.id} node={node} depth={0} ctx={ctx} />
							))}
						</ul>
					)}
				</nav>

				<div className="border-t border-line2 px-2.5 pt-2 pb-3">
					<button
						type="button"
						onClick={() => setShowTrash((v) => !v)}
						aria-expanded={showTrash}
						className={`flex h-11 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-[13px] text-ink2 hover:bg-hover md:h-8 ${showTrash ? "bg-hover" : ""}`}
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
							aria-hidden="true"
						>
							<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.2c0 .5.4.8.9.8h4c.5 0 .9-.3.9-.8l.6-8.2" />
						</svg>
						<span className="flex-1 text-left">Trash</span>
						{trash.length > 0 ? (
							<span className="text-xs text-mute">{trash.length}</span>
						) : null}
					</button>
					{showTrash ? (
						<ul className="max-h-48 overflow-y-auto">
							{trash.length === 0 ? (
								<li className="px-3 py-1.5 text-sm text-mute">
									Trash is empty.
								</li>
							) : (
								trash.map((n) => (
									<li
										key={n.id}
										className="flex items-center justify-between gap-2 px-2.5 py-1 text-[13px]"
									>
										<span className="truncate text-mute">
											{n.title || "Untitled"}
										</span>
										<button
											type="button"
											onClick={() => restoreNote(workspace.index, n.id)}
											className="shrink-0 text-accent hover:underline"
										>
											Restore
										</button>
									</li>
								))
							)}
						</ul>
					) : null}
				</div>
			</aside>
		</>
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
				draggable
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
				className={`row group flex items-center rounded-[10px] ${active ? "bg-hover" : "hover:bg-hover/60"} ${zone ? `drop-${zone}` : ""}`}
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
				<Link
					{...pageLink(note.id, note.title)}
					aria-current={active ? "page" : undefined}
					className={`min-w-0 flex-1 truncate py-2.5 text-sm md:py-[7px] ${active ? "font-medium text-ink" : "text-ink2"}`}
				>
					{note.title || "Untitled"}
				</Link>
				<RowMenu note={note} ctx={ctx} />
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
				? siblingsOf(workspace.getNotes(), note.parentId).find(
						(_, i, all) => all[i + 1]?.id === note.id,
					)
				: undefined;
		if (nudgeNote(workspace.index, note.id, dir) && newParent) {
			ctx.toggle(newParent.id, true);
		}
		setOpen(false);
	};

	const items: { label: string; run: () => void; danger?: boolean }[] = [
		{ label: "Add subpage", run: () => ctx.addChild(note.id) },
		{ label: "Move up", run: () => nudge("up") },
		{ label: "Move down", run: () => nudge("down") },
		{ label: "Indent", run: () => nudge("indent") },
		{ label: "Outdent", run: () => nudge("outdent") },
		{
			label: "Move to trash",
			run: () => trashNote(workspace.index, note.id),
			danger: true,
		},
	];

	return (
		<div ref={root} className="relative">
			<button
				type="button"
				aria-label={`Actions for ${note.title || "Untitled"}`}
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
				data-open={open}
				className="row-actions flex h-8 w-8 items-center justify-center rounded-[10px] text-mute hover:text-ink"
			>
				<span aria-hidden>⋯</span>
			</button>
			{open ? (
				<div
					role="menu"
					className="absolute top-full right-0 z-50 mt-1 w-44 rounded-[14px] border border-line bg-raised p-1 shadow-lg"
				>
					{items.map((item) => (
						<button
							key={item.label}
							type="button"
							role="menuitem"
							onClick={() => {
								item.run();
								setOpen(false);
							}}
							className={`block w-full rounded-[10px] px-3 py-1.5 text-left text-sm hover:bg-hover ${item.danger ? "text-accent" : "text-ink"}`}
						>
							{item.label}
						</button>
					))}
				</div>
			) : null}
		</div>
	);
}
