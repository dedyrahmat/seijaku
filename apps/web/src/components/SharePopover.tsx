import { useEffect, useRef } from "react";

/**
 * The mockup's "Share to the web" popover. Public links are served by the server and need
 * sign-in (phases 4 and 7), so the switch is shown off and cannot be turned on yet.
 */
export function SharePopover({ onClose }: { onClose: () => void }) {
	const root = useRef<HTMLDivElement>(null);

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
					aria-checked={false}
					aria-label="Share to the web"
					disabled
					className="relative h-[26px] w-11 flex-none rounded-full bg-off disabled:cursor-default"
				>
					<span
						aria-hidden
						className="absolute top-[3px] left-[3px] size-5 rounded-full bg-paper"
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
					value=""
					placeholder="Appears when sharing is on"
					className="h-[38px] min-w-0 flex-1 rounded-[14px] border border-line bg-paper px-3 font-mono text-[12.5px] text-ink placeholder:text-mute"
				/>
				<button
					type="button"
					disabled
					className="h-[38px] rounded-[14px] bg-ink px-4 text-[13px] font-medium text-paper disabled:cursor-default disabled:opacity-40"
				>
					Copy link
				</button>
			</div>

			<p className="border-t border-line2 pt-3.5 text-[13px] leading-normal text-mute">
				Public links need your server and a signed-in account, so sharing opens
				up with sign-in. Revoking will turn a link off for good; sharing again
				creates a new one.
			</p>
		</div>
	);
}
