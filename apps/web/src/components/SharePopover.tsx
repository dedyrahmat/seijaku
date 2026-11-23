import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/session";
import { useNotes } from "../workspace/hooks";
import {
	canShare,
	setShareExpiry,
	shareLink,
	startSharing,
	stopSharing,
} from "../workspace/shares";
import { ago } from "./ago";
import { askConfirm } from "./Dialogs";
import { PeopleSection } from "./PeopleSection";
import { Select } from "./SettingRows";

const DAY = 86_400_000;
const EXPIRY = ["never", "d1", "d7", "d30"] as const;

/**
 * The mockup's Share to the web popover. Sharing publishes a sealed copy of this one page
 * (sub-pages are not included); the key is in the link, so only people with the link can read
 * it, and the server cannot. Revoking deletes the copy and kills the link for good.
 */
export function SharePopover({
	noteId,
	onClose,
}: {
	noteId: string;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const root = useRef<HTMLDivElement>(null);
	const share = useNotes().find((n) => n.id === noteId)?.share ?? null;
	const auth = useAuth();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		const close = (e: Event) => {
			const target = e.target as Element | null;
			if (
				!root.current?.contains(target as Node) &&
				!target?.closest("[data-share-trigger]")
			)
				onClose();
		};
		const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		document.addEventListener("pointerdown", close);
		document.addEventListener("keydown", esc);
		return () => {
			document.removeEventListener("pointerdown", close);
			document.removeEventListener("keydown", esc);
		};
	}, [onClose]);

	const run = async (job: () => Promise<unknown>) => {
		setBusy(true);
		setError(null);
		try {
			await job();
		} catch (err) {
			setError(err instanceof Error ? err.message : t("common.wrong"));
		} finally {
			setBusy(false);
		}
	};

	const turnOn = () => run(() => startSharing(noteId));
	const revoke = async () => {
		if (
			await askConfirm(t("share.confirm"), {
				confirm: t("share.revoke"),
				danger: true,
			})
		)
			void run(() => stopSharing(noteId));
	};
	const expires = share?.expires ?? null;
	const expired = expires !== null && expires <= Date.now();
	// The date is stored, the choice is not: show the nearest option still ahead.
	const left = expires === null ? 0 : (expires - Date.now()) / DAY;
	const choice: (typeof EXPIRY)[number] =
		expires === null ? "never" : left <= 1 ? "d1" : left <= 7 ? "d7" : "d30";
	const pickExpiry = (v: (typeof EXPIRY)[number]) =>
		run(() =>
			setShareExpiry(
				noteId,
				v === "never" ? null : Date.now() + Number(v.slice(1)) * DAY,
			),
		);
	const link = share ? shareLink(share) : "";
	const signedIn = auth.phase === "signed-in" && canShare();

	const created = share
		? new Date(share.at).toLocaleString(undefined, {
				day: "numeric",
				month: "short",
				hour: "2-digit",
				minute: "2-digit",
				hour12: false,
			})
		: "";

	return (
		<div
			ref={root}
			role="dialog"
			aria-label={t("share.title")}
			className="fixed top-[calc(env(safe-area-inset-top)+56px)] right-3 md:top-[46px] z-50 flex max-h-[calc(100dvh-64px)] w-[400px] max-w-[calc(100vw-24px)] flex-col gap-4 overflow-y-auto rounded-2xl border border-line bg-raised p-5 shadow-[0_18px_50px_rgba(40,30,15,0.16),0_2px_6px_rgba(40,30,15,0.08)]"
		>
			<div className="flex items-start gap-4">
				<div className="flex flex-1 flex-col gap-1">
					<span className="font-serif text-xl font-medium">
						{t("share.heading")}
					</span>
					<span className="text-[13px] leading-normal text-ink2">
						{t("share.desc")}
					</span>
				</div>
				<button
					type="button"
					role="switch"
					aria-checked={Boolean(share)}
					aria-label={t("share.heading")}
					disabled={busy || (!share && !signedIn)}
					onClick={() => (share ? revoke() : void turnOn())}
					className={`relative h-[26px] w-11 flex-none rounded-full disabled:cursor-default disabled:opacity-50 ${share ? "bg-ink" : "bg-off"}`}
				>
					<span
						aria-hidden
						className={`absolute top-[3px] size-5 rounded-full bg-paper ${share ? "left-[21px]" : "left-[3px]"}`}
					/>
				</button>
			</div>

			<div className="flex gap-2">
				<label htmlFor="share-link" className="sr-only">
					{t("share.publicLink")}
				</label>
				<input
					id="share-link"
					type="text"
					readOnly
					value={link}
					onFocus={(e) => e.currentTarget.select()}
					placeholder={t("share.placeholder")}
					className="h-[38px] min-w-0 flex-1 rounded-full border border-line bg-paper px-3 font-mono text-[12.5px] text-ink placeholder:text-mute"
				/>
				<button
					type="button"
					disabled={!share}
					onClick={() => {
						void navigator.clipboard?.writeText(link).then(() => {
							setCopied(true);
							setTimeout(() => setCopied(false), 1800);
						});
					}}
					className="h-[38px] rounded-full bg-ink px-4 text-[13px] font-medium text-paper disabled:cursor-default disabled:opacity-40"
				>
					{copied ? t("common.copied") : t("common.copyLink")}
				</button>
			</div>

			{error ? (
				<p role="alert" className="text-[13px] text-accent">
					{error}
				</p>
			) : null}

			{share ? (
				<>
					<div className="flex items-center justify-between border-t border-line2 pt-3.5 text-[13px] text-mute">
						<span>{t("share.created", { when: created })}</span>
						<button
							type="button"
							disabled={busy}
							onClick={revoke}
							className="py-1 text-[13px] font-medium text-accent"
						>
							{t("share.revoke")}
						</button>
					</div>
					<div className="flex items-center gap-3 text-[13px]">
						<div className="flex flex-1 flex-col">
							<span className="text-ink">{t("share.expires.label")}</span>
							<span className={expired ? "text-accent" : "text-mute"}>
								{expires === null
									? t("share.expires.desc")
									: t(expired ? "share.expires.past" : "share.expires.on", {
											when: expired
												? ago(expires, Date.now())
												: new Date(expires).toLocaleDateString(undefined, {
														day: "numeric",
														month: "short",
													}),
										})}
							</span>
						</div>
						{expired ? (
							<button
								type="button"
								disabled={busy}
								onClick={() => void run(() => setShareExpiry(noteId, null))}
								className="h-9 rounded-full border border-line px-4 text-[13px] font-medium"
							>
								{t("share.renew")}
							</button>
						) : null}
						<Select
							label={t("share.expires.label")}
							value={choice}
							options={EXPIRY}
							labels={{
								never: t("share.expires.never"),
								d1: t("share.expires.d1"),
								d7: t("share.expires.d7"),
								d30: t("share.expires.d30"),
							}}
							onChange={pickExpiry}
							disabled={busy}
						/>
					</div>
					<p className="-mt-1.5 text-xs leading-normal text-mute">
						{t("share.revokeNote")}
					</p>
				</>
			) : (
				<p className="border-t border-line2 pt-3.5 text-[13px] leading-normal text-mute">
					{signedIn ? (
						t("share.encrypted")
					) : (
						<>
							{t("share.needsAccount")}{" "}
							<Link to="/sign-in" className="text-ink underline">
								{t("account.signIn")}
							</Link>
							.
						</>
					)}
				</p>
			)}
			<PeopleSection noteId={noteId} />
		</div>
	);
}
