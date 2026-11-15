import type { NoteMeta } from "@seijaku/sync";
import {
	Link,
	Outlet,
	useParams,
	useRouterState,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Logo } from "../components/Logo";
import { Sidebar } from "../components/Sidebar";
import {
	readLocal,
	useNotes,
	useWorkspaceReady,
	writeLocal,
} from "../workspace/hooks";

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
	const [typing, setTyping] = useState(false);
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [sidebarHidden, setSidebarHidden] = useState(
		() => readLocal(SIDEBAR_HIDDEN_KEY) === "1",
	);
	const path = useRouterState({ select: (s) => s.location.pathname });
	const { noteId } = useParams({ strict: false }) as { noteId?: string };

	// Close the mobile drawer after navigating.
	// biome-ignore lint/correctness/useExhaustiveDependencies: path is the trigger
	useEffect(() => setDrawerOpen(false), [path]);

	// Typing steps the chrome back; any pointer movement brings it home.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.metaKey || e.ctrlKey || e.altKey || e.key === "Escape") return;
			const el = e.target as HTMLElement | null;
			if (el?.closest(".bn-editor, input[data-title]")) setTyping(true);
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

	if (!ready) return <div className="h-dvh bg-paper" aria-busy="true" />;

	const crumbs = trail(notes, noteId);
	const toggleSidebar = () =>
		setSidebarHidden((v) => {
			writeLocal(SIDEBAR_HIDDEN_KEY, v ? "0" : "1");
			return !v;
		});

	return (
		<div
			data-typing={typing && !drawerOpen}
			className="flex h-dvh overflow-hidden bg-paper text-ink"
		>
			<Sidebar
				open={drawerOpen}
				onClose={() => setDrawerOpen(false)}
				hidden={sidebarHidden}
			/>
			<div className="flex min-w-0 flex-1 flex-col">
				{/* Phone: open the drawer. */}
				<header className="chrome flex h-12 items-center gap-3 border-b border-line2 bg-panel px-3 pt-[env(safe-area-inset-top)] md:hidden">
					<button
						type="button"
						onClick={() => setDrawerOpen(true)}
						className="flex size-11 items-center justify-center rounded-[10px] text-ink2 hover:bg-hover"
						aria-label="Open pages"
					>
						<Icon>
							<rect x="2" y="3" width="12" height="10" rx="2" />
							<path d="M6 3v10" />
						</Icon>
					</button>
					<Logo size={24} />
					<span className="font-serif text-lg font-medium">Seijaku</span>
				</header>

				{/* Desktop: sidebar toggle, breadcrumb, status. */}
				<header className="chrome hidden h-10 flex-none items-center gap-1 border-b border-line2 bg-panel pr-4 pl-2.5 md:flex">
					<button
						type="button"
						onClick={toggleSidebar}
						aria-label={sidebarHidden ? "Show sidebar" : "Hide sidebar"}
						aria-pressed={!sidebarHidden}
						className="flex h-7 w-8 items-center justify-center rounded-[10px] text-ink2 hover:bg-hover"
					>
						<Icon>
							<rect x="2" y="3" width="12" height="10" rx="2" />
							<path d="M6 3v10" />
						</Icon>
					</button>
					<nav
						aria-label="Breadcrumb"
						className="ml-3 flex min-w-0 items-center gap-2 text-[13px] text-ink2"
					>
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
											to="/n/$noteId"
											params={{ noteId: n.id }}
											className="truncate hover:text-ink"
										>
											{n.title || "Untitled"}
										</Link>
									)}
								</span>
							);
						})}
					</nav>
					<div className="flex-1" />
					<div className="flex items-center gap-1.5 text-xs text-ink2">
						<span aria-hidden className="size-[7px] rounded-full bg-mute" />
						Saved on this device
					</div>
				</header>

				<main className="min-h-0 flex-1 overflow-y-auto">
					<Outlet />
				</main>
			</div>
		</div>
	);
}
