import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/session";
import type { Block } from "../editor/headless";
import {
	listVersions,
	restoreVersion,
	saveSnapshot,
	type VersionEntry,
	versionBlocks,
} from "../workspace/history";
import { useNoteSession, useNotes, useWordCount } from "../workspace/hooks";
import { ago } from "./ago";
import { Icon } from "./Icon";

/** What the title bar needs to draw the "Previewing…" bar and the old version under it. */
export interface Preview {
	label: string;
	title: string;
	blocks: Block[];
	restore: () => Promise<void>;
}

const DAY = 86_400_000;

function clock(at: number): string {
	return new Date(at).toLocaleTimeString(undefined, {
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
}

function group(at: number, now: number): "Today" | "Yesterday" | "Earlier" {
	const start = new Date(now).setHours(0, 0, 0, 0);
	return at >= start ? "Today" : at >= start - DAY ? "Yesterday" : "Earlier";
}

function stamp(at: number, now: number): string {
	return group(at, now) === "Earlier"
		? new Date(at).toLocaleString(undefined, {
				weekday: "short",
				day: "numeric",
				month: "short",
				hour: "2-digit",
				minute: "2-digit",
				hour12: false,
			})
		: clock(at);
}

/**
 * The mockup's Version history panel. Snapshots are sealed on this device and kept by the
 * server; picking one previews it read-only above the page, and restoring adds it back as an
 * edit. Listing needs a connection.
 */
export function HistoryPanel({
	noteId,
	previewId,
	onPreview,
	onClose,
}: {
	noteId: string;
	previewId: string | null;
	onPreview: (id: string | null, preview: Preview | null) => void;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const note = useNotes().find((n) => n.id === noteId);
	const words = useWordCount(useNoteSession(noteId));
	const auth = useAuth();
	const [now, setNow] = useState(() => Date.now());
	const [versions, setVersions] = useState<VersionEntry[] | null>(null);
	const [problem, setProblem] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const load = useMemo(
		() => async () => {
			try {
				setVersions(await listVersions(noteId));
				setProblem(null);
			} catch {
				setProblem(t("history.listFailed"));
			}
		},
		[noteId, t],
	);

	useEffect(() => {
		if (auth.phase !== "signed-in") return;
		// Make sure there is at least the state as of now to come back to, then list.
		void saveSnapshot(noteId).then(load);
	}, [auth.phase, noteId, load]);

	useEffect(() => {
		const t = setInterval(() => setNow(Date.now()), 30_000);
		const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		window.addEventListener("keydown", esc);
		return () => {
			clearInterval(t);
			window.removeEventListener("keydown", esc);
		};
	}, [onClose]);

	// Leaving the panel leaves the preview.
	useEffect(() => () => onPreview(null, null), [onPreview]);

	const pick = async (v: VersionEntry) => {
		setBusy(true);
		try {
			const blocks = await versionBlocks(noteId, v.id);
			onPreview(v.id, {
				label:
					group(v.at, Date.now()) === "Today"
						? t("history.todayAt", { time: clock(v.at) })
						: stamp(v.at, Date.now()),
				title: note?.title ?? "",
				blocks,
				restore: async () => {
					await restoreVersion(noteId, v.id);
					onPreview(null, null);
					await load();
				},
			});
			setProblem(null);
		} catch {
			setProblem(t("history.openFailed"));
		} finally {
			setBusy(false);
		}
	};

	// Oldest first to work out how many words each version added.
	const rows = useMemo(() => {
		const list = versions ?? [];
		return list.map((v, i) => {
			const before = list[i + 1];
			const delta = before ? v.words - before.words : 0;
			const created =
				!before && note && Math.abs(v.at - note.createdAt) < 5 * 60_000;
			return { v, delta, created };
		});
	}, [versions, note]);

	const grouped: { label: string; items: typeof rows }[] = [];
	for (const r of rows) {
		const label = group(r.v.at, now);
		const last = grouped.at(-1);
		if (last?.label === label) last.items.push(r);
		else grouped.push({ label, items: [r] });
	}

	const currentSelected = previewId === null;

	return (
		<aside
			aria-label={t("shell.history")}
			className="fixed inset-y-0 right-0 z-40 flex w-80 max-w-[85vw] flex-col border-l border-line2 bg-panel pt-[env(safe-area-inset-top)] shadow-[-8px_0_40px_rgba(40,30,15,0.18)] lg:static lg:max-w-none lg:shadow-none"
		>
			<div className="flex h-[52px] flex-none items-center border-b border-line2 px-5">
				<span className="flex-1 font-serif text-[19px] font-medium">
					{t("history.title")}
				</span>
				<button
					type="button"
					onClick={onClose}
					aria-label={t("history.close")}
					className="flex size-11 items-center justify-center rounded-full text-ink2 hover:bg-hover md:size-[30px]"
				>
					<Icon name="close" size={14} />
				</button>
			</div>
			<div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 py-2">
				<div className="px-2.5 pt-3.5 pb-1.5 text-[11px] font-medium tracking-[0.09em] text-mute uppercase">
					{t("history.group.Today")}
				</div>
				<button
					type="button"
					aria-current={currentSelected ? "true" : undefined}
					onClick={() => onPreview(null, null)}
					className={`flex w-full flex-col gap-0.5 rounded-2xl px-3 py-2.5 text-left hover:bg-hover ${currentSelected ? "bg-hover" : ""}`}
				>
					<span className="flex justify-between text-sm font-medium">
						<span>{t("history.current")}</span>
						<span className="text-xs font-normal text-mute">
							{t("footer.words", { count: words })}
						</span>
					</span>
					<span className="text-xs text-mute">
						{t("history.deviceEdited", {
							when: ago(note?.updatedAt ?? null, now),
						})}
					</span>
				</button>

				{grouped.map((g) => (
					<div key={g.label} className="flex flex-col gap-0.5">
						{g.label !== "Today" ? (
							<div className="px-2.5 pt-3.5 pb-1.5 text-[11px] font-medium tracking-[0.09em] text-mute uppercase">
								{t(`history.group.${g.label as ReturnType<typeof group>}`)}
							</div>
						) : null}
						{g.items.map(({ v, delta, created }) => (
							<button
								key={v.id}
								type="button"
								disabled={busy}
								aria-current={previewId === v.id ? "true" : undefined}
								onClick={() => void pick(v)}
								className={`flex w-full flex-col gap-0.5 rounded-2xl px-3 py-2.5 text-left hover:bg-hover ${previewId === v.id ? "bg-hover" : ""}`}
							>
								<span className="flex justify-between text-sm font-medium">
									<span>{stamp(v.at, now)}</span>
									<span className="text-xs font-normal text-mute">
										{delta === 0
											? ""
											: `${delta > 0 ? "+" : "−"}${t("footer.words", { count: Math.abs(delta) })}`}
									</span>
								</span>
								<span className="text-xs text-mute">
									{created
										? t("history.created")
										: v.here
											? t("history.fromHere")
											: t("history.fromOther")}
								</span>
							</button>
						))}
					</div>
				))}

				{auth.phase !== "signed-in" ? (
					<p className="px-2.5 pt-4 text-[13px] leading-normal text-mute">
						{t("history.signIn")}
					</p>
				) : problem ? (
					<p
						role="alert"
						className="px-2.5 pt-4 text-[13px] leading-normal text-accent"
					>
						{problem}
					</p>
				) : versions && versions.length === 0 ? (
					<p className="px-2.5 pt-4 text-[13px] leading-normal text-mute">
						{t("history.empty")}
					</p>
				) : null}
			</div>
			<p className="border-t border-line2 px-5 pt-3.5 pb-[18px] text-xs leading-[1.55] text-mute">
				{t("history.note")}
			</p>
		</aside>
	);
}
