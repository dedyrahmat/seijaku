import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/session";
import { useHomeScreenNotice, useSyncState } from "../workspace/hooks";
import { ago } from "./ago";

/**
 * The one quiet status in the title bar ("Sync, said quietly" in the design). Dot and
 * label only; it grows louder only when something needs attention. Pressing it opens the
 * plain-language line for the current state.
 */

type Kind = "synced" | "syncing" | "offline" | "keep-safe" | "local";

export function SyncStatus() {
	const { t } = useTranslation();
	const state = useSyncState();
	const keepSafe = useHomeScreenNotice();
	const signedOut = useAuth().phase === "signed-out";
	const [open, setOpen] = useState(false);
	const [now, setNow] = useState(() => Date.now());
	const root = useRef<HTMLDivElement>(null);

	// Offline beats everything; the Home Screen notice stays until the browser agrees to keep our data.
	const kind: Kind = signedOut
		? "local"
		: state.status === "offline"
			? "offline"
			: keepSafe
				? "keep-safe"
				: state.status;

	useEffect(() => {
		if (!open) return;
		setNow(Date.now());
		const tick = setInterval(() => setNow(Date.now()), 30_000);
		const close = (e: Event) => {
			if (!root.current?.contains(e.target as Node)) setOpen(false);
		};
		const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
		document.addEventListener("pointerdown", close);
		document.addEventListener("keydown", esc);
		return () => {
			clearInterval(tick);
			document.removeEventListener("pointerdown", close);
			document.removeEventListener("keydown", esc);
		};
	}, [open]);

	const label = {
		local: t("sync.local"),
		synced: t("sync.synced"),
		syncing: t("sync.syncing"),
		offline: t("sync.offline"),
		"keep-safe": t("sync.keepSafe"),
	}[kind];

	const detail = {
		local: t("sync.detail.local"),
		synced: t("sync.detail.synced", { when: ago(state.lastSyncedAt, now) }),
		syncing:
			state.pending > 0
				? t("sync.detail.sending", { count: state.pending })
				: t("sync.detail.catching"),
		offline:
			state.pending > 0
				? t("sync.detail.offlineWaiting", { count: state.pending })
				: t("sync.detail.offline"),
		"keep-safe": t("settings.sync.connection.keepSafe"),
	}[kind];

	// Filled dot: settled. Ring: in progress or waiting on you. Vermilion: needs attention.
	const accent = kind === "offline" || kind === "keep-safe";
	const hollow = kind === "syncing" || kind === "keep-safe" || kind === "local";
	const colour = accent ? "var(--accent)" : "var(--mute)";

	return (
		<div ref={root} className="relative">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				aria-expanded={open}
				aria-haspopup="dialog"
				data-sync={kind}
				className="flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs text-ink2 hover:bg-hover md:h-7"
			>
				<span
					aria-hidden
					className="size-[7px] shrink-0 rounded-full"
					style={{
						background: hollow ? "transparent" : colour,
						boxShadow: hollow ? `inset 0 0 0 1.5px ${colour}` : undefined,
					}}
				/>
				<span role="status" className="whitespace-nowrap">
					{label}
				</span>
			</button>
			{open ? (
				<div
					role="dialog"
					aria-label={t("sync.status")}
					className="absolute top-full right-0 z-50 mt-1 w-72 max-w-[calc(100vw-24px)] rounded-2xl border border-line bg-raised p-4 shadow-lg"
				>
					<p className="text-sm leading-[1.55] text-ink2 [text-wrap:pretty]">
						{detail}
					</p>
					{kind === "local" ? (
						<Link
							to="/sign-in"
							className="mt-2.5 inline-block text-sm text-ink underline underline-offset-[3px]"
						>
							{t("sync.signIn")}
						</Link>
					) : null}
				</div>
			) : null}
		</div>
	);
}
