/** The tick box on rows in "Select pages" mode. Decorative: the row it sits in is the checkbox. */
export function SelectBox({ on }: { on: boolean }) {
	return (
		<span
			aria-hidden
			className={`flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px] ${on ? "border-ink bg-ink" : "border-mute"}`}
		>
			{on ? (
				<svg
					width="12"
					height="12"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					strokeWidth="2.2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
					className="text-paper"
				>
					<path d="M3.5 8.5l3 3 6-7" />
				</svg>
			) : null}
		</span>
	);
}
