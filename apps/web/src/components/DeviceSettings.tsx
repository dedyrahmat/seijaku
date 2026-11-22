import { setWorkspaceName } from "@seijaku/sync";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { authStore } from "../auth/session";
import { CLEAR_FLAG } from "../clearPending";
import { i18n } from "../i18n";
import { queuedUploads } from "../workspace/files";
import { useNotes, useWorkspaceName } from "../workspace/hooks";
import { shareLink, stopSharing } from "../workspace/shares";
import { workspace } from "../workspace/store";
import { Btn, Row, TextField } from "./SettingRows";

/** Settings rows that only need this device: the pieces behind Manage links and Clear cache. */

export function Modal({
	title,
	onClose,
	children,
	actions,
}: {
	title: string;
	onClose: () => void;
	children: ReactNode;
	actions?: ReactNode;
}) {
	useEffect(() => {
		const esc = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			// Settings listens for Escape too; this one closes only the dialog on top.
			e.stopImmediatePropagation();
			onClose();
		};
		window.addEventListener("keydown", esc, true);
		return () => window.removeEventListener("keydown", esc, true);
	}, [onClose]);
	return (
		<div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/35 p-5">
			<div
				ref={(el) => el?.focus()}
				tabIndex={-1}
				role="alertdialog"
				aria-modal="true"
				aria-label={title}
				className="flex max-h-full w-[560px] max-w-full flex-col overflow-hidden rounded-2xl border border-line bg-paper shadow-[0_30px_80px_rgba(40,30,15,0.28),0_2px_8px_rgba(40,30,15,0.1)]"
			>
				<h2 className="border-b border-line px-[22px] py-[18px] font-serif text-xl font-medium">
					{title}
				</h2>
				<div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
				{actions ? (
					<div className="flex justify-end gap-2.5 border-t border-line px-[22px] py-3.5">
						{actions}
					</div>
				) : null}
			</div>
		</div>
	);
}

/** The workspace's name: edited here, saved when you leave the field, synced and sealed like a title. */
export function WorkspaceNameField() {
	const { t } = useTranslation();
	const saved = useWorkspaceName();
	const [text, setText] = useState(saved);
	useEffect(() => setText(saved), [saved]);
	const commit = () => setWorkspaceName(workspace.index, text);
	return (
		<TextField
			label={t("settings.general.workspaceName.label")}
			value={text}
			onChange={setText}
			onCommit={commit}
			placeholder="Seijaku"
		/>
	);
}

/** Pages shared with a link, read from the notes on this device. */
export function ManageLinks() {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const shared = useNotes().filter((n) => n.share);
	return (
		<>
			<Row
				label={t("links.title")}
				desc={t("links.desc")}
				note={
					shared.length === 0
						? t("links.noneShared")
						: t("links.count", { count: shared.length })
				}
			>
				<Btn onClick={() => setOpen(true)}>{t("links.manage")}</Btn>
			</Row>
			{open ? <LinksDialog onClose={() => setOpen(false)} /> : null}
		</>
	);
}

function LinksDialog({ onClose }: { onClose: () => void }) {
	const { t } = useTranslation();
	const shared = useNotes().filter((n) => n.share);
	const [copied, setCopied] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [stopping, setStopping] = useState<string | null>(null);

	const stop = async (id: string) => {
		setStopping(id);
		setError(null);
		try {
			await stopSharing(id);
		} catch (err) {
			setError(err instanceof Error ? err.message : t("links.stopFailed"));
		} finally {
			setStopping(null);
		}
	};

	return (
		<Modal
			title={t("links.title")}
			onClose={onClose}
			actions={
				<button
					type="button"
					onClick={onClose}
					className="h-9 rounded-2xl bg-ink px-4 text-[13px] font-medium text-paper"
				>
					{t("common.done")}
				</button>
			}
		>
			{shared.length === 0 ? (
				<p className="px-[22px] py-9 text-center text-sm leading-relaxed text-mute">
					{t("links.nothing")}
					<br />
					{t("links.useShare")}
				</p>
			) : (
				<ul>
					{shared.map((n) => (
						<li
							key={n.id}
							className="flex flex-wrap items-center gap-3 border-b border-line px-[22px] py-3"
						>
							<div className="min-w-[180px] flex-1">
								<span className="block truncate text-sm font-medium">
									{n.title.trim() || t("common.untitled")}
									{n.trashed ? ` ${t("links.inTrash")}` : ""}
								</span>
								<span className="text-[13px] text-mute">
									{t("links.shared", {
										date: n.share
											? new Date(n.share.at).toLocaleDateString()
											: "",
									})}
								</span>
							</div>
							<Btn
								onClick={() =>
									n.share &&
									window.open(shareLink(n.share), "_blank", "noopener")
								}
							>
								{t("common.open")}
							</Btn>
							<Btn
								onClick={() => {
									if (!n.share) return;
									void navigator.clipboard
										?.writeText(shareLink(n.share))
										.then(() => {
											setCopied(n.id);
											setTimeout(() => setCopied(null), 1800);
										});
								}}
							>
								{copied === n.id ? t("common.copied") : t("common.copyLink")}
							</Btn>
							<Btn
								danger
								disabled={stopping === n.id}
								onClick={() => void stop(n.id)}
							>
								{stopping === n.id ? t("links.stopping") : t("links.stop")}
							</Btn>
						</li>
					))}
				</ul>
			)}
			{error ? (
				<p role="alert" className="px-[22px] pt-3 text-[13px] text-accent">
					{error}
				</p>
			) : null}
			<p className="mx-[22px] my-4 rounded-xl bg-panel px-3.5 py-3 text-[13px] leading-normal text-ink2">
				{t("links.explain")}
			</p>
		</Modal>
	);
}

function megabytes(bytes: number): string {
	const mb = bytes / 1_048_576;
	return mb < 0.1 ? i18n.t("cache.underMb") : `${mb.toFixed(1)} MB`;
}

type CacheStep =
	| { step: "idle" }
	| { step: "asking"; used: number | null }
	| { step: "refused"; why: string };

/** Offline storage: what it holds, and a careful way to empty it. Refused while anything is not yet on the server. */
export function ClearCache() {
	const { t } = useTranslation();
	const [state, setState] = useState<CacheStep>({ step: "idle" });

	const ask = async () => {
		const used = (await navigator.storage?.estimate?.())?.usage ?? null;
		const signedIn = authStore.getState().phase === "signed-in";
		const waiting = workspace.sync.getState().pending;
		const uploads = await queuedUploads();
		if (!signedIn)
			return setState({
				step: "refused",
				why: i18n.t("cache.noAccount"),
			});
		if (waiting > 0 || uploads > 0)
			return setState({
				step: "refused",
				why: i18n.t("cache.waiting", { count: waiting + uploads }),
			});
		if (workspace.sync.getState().status === "offline")
			return setState({
				step: "refused",
				why: i18n.t("cache.offline"),
			});
		setState({ step: "asking", used });
	};

	const clear = () => {
		try {
			localStorage.setItem(CLEAR_FLAG, "1");
		} catch {
			return setState({
				step: "refused",
				why: i18n.t("cache.blocked"),
			});
		}
		location.reload();
	};

	const close = () => setState({ step: "idle" });
	return (
		<>
			<Btn onClick={() => void ask()}>{t("cache.clear")}</Btn>
			{state.step === "asking" ? (
				<Modal
					title={t("cache.title")}
					onClose={close}
					actions={
						<>
							<Btn onClick={close}>{t("common.cancel")}</Btn>
							<button
								type="button"
								onClick={clear}
								className="h-9 rounded-2xl bg-ink px-4 text-[13px] font-medium text-paper"
							>
								{t("cache.confirm")}
							</button>
						</>
					}
				>
					<div className="flex flex-col gap-1 px-[22px] py-4">
						<b className="text-sm font-medium">
							{state.used === null
								? t("cache.onDevice")
								: t("cache.used", { size: megabytes(state.used) })}
						</b>
						<span className="text-[13px] leading-normal text-mute">
							{t("cache.explain")}
						</span>
					</div>
				</Modal>
			) : null}
			{state.step === "refused" ? (
				<Modal
					title={t("cache.notYet")}
					onClose={close}
					actions={
						<button
							type="button"
							onClick={close}
							className="h-9 rounded-2xl bg-ink px-4 text-[13px] font-medium text-paper"
						>
							{t("common.ok")}
						</button>
					}
				>
					<p className="px-[22px] py-4 text-sm leading-relaxed text-ink2">
						{state.why}
					</p>
				</Modal>
			) : null}
		</>
	);
}
