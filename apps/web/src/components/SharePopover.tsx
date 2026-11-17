import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/session";
import { useNotes } from "../workspace/hooks";
import {
	canShare,
	shareLink,
	startSharing,
	stopSharing,
} from "../workspace/shares";

/**
 * The mockup's "Share to the web" popover. Sharing publishes a sealed copy of this one page
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
			setError(err instanceof Error ? err.message : "Something went wrong.");
		} finally {
			setBusy(false);
		}
	};

	const turnOn = () => run(() => startSharing(noteId));
	const revoke = () => {
		if (
			window.confirm(
				"Turn this link off for good? Anyone who has it will see that the page is gone.",
			)
		)
			void run(() => stopSharing(noteId));
	};
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
			aria-label="Share this page"
			className="fixed top-[46px] right-3 z-50 flex w-[400px] max-w-[calc(100vw-24px)] flex-col gap-4 rounded-3xl border border-line bg-raised p-5 shadow-[0_18px_50px_rgba(40,30,15,0.16),0_2px_6px_rgba(40,30,15,0.08)]"
		>
			<div className="flex items-start gap-4">
				<div className="flex flex-1 flex-col gap-1">
					<span className="font-serif text-xl font-medium">
						Share to the web
					</span>
					<span className="text-[13px] leading-normal text-ink2">
						Anyone with the link can read this page. They cannot edit it, and
						sub-pages are not included.
					</span>
				</div>
				<button
					type="button"
					role="switch"
					aria-checked={Boolean(share)}
					aria-label="Share to the web"
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
					Public link
				</label>
				<input
					id="share-link"
					type="text"
					readOnly
					value={link}
					onFocus={(e) => e.currentTarget.select()}
					placeholder="Appears when sharing is on"
					className="h-[38px] min-w-0 flex-1 rounded-[14px] border border-line bg-paper px-3 font-mono text-[12.5px] text-ink placeholder:text-mute"
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
					className="h-[38px] rounded-[14px] bg-ink px-4 text-[13px] font-medium text-paper disabled:cursor-default disabled:opacity-40"
				>
					{copied ? "Copied" : "Copy link"}
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
						<span>Link created {created}</span>
						<button
							type="button"
							disabled={busy}
							onClick={revoke}
							className="py-1 text-[13px] font-medium text-accent"
						>
							Revoke link
						</button>
					</div>
					<p className="-mt-1.5 text-xs leading-normal text-mute">
						Revoking turns the link off for good. Sharing again creates a new
						one.
					</p>
				</>
			) : (
				<p className="border-t border-line2 pt-3.5 text-[13px] leading-normal text-mute">
					{signedIn ? (
						"The page is encrypted before it leaves this device. The key is part of the link, so your server cannot read it."
					) : (
						<>
							Sharing needs an account, because your server hosts the link.{" "}
							<Link to="/sign-in" className="text-ink underline">
								Sign in
							</Link>
							.
						</>
					)}
				</p>
			)}
		</div>
	);
}
