import { useEffect, useRef, useState } from "react";
import { isoDay } from "./dates";
import { Icon } from "./Icon";

const fromIso = (s: string) => {
	const [y, m, d] = s.split("-").map(Number);
	return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
};

/** A quiet calendar popover in place of the browser's own date picker. `value` is `YYYY-MM-DD` or "". */
export function DatePicker({
	value,
	onChange,
	label,
	className = "",
}: {
	value: string;
	onChange: (iso: string) => void;
	label: string;
	className?: string;
}) {
	const [open, setOpen] = useState(false);
	const [month, setMonth] = useState(() =>
		fromIso(value || isoDay(new Date())),
	);
	const root = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		if (!open) return;
		const away = (e: MouseEvent) =>
			!root.current?.contains(e.target as Node) && setOpen(false);
		const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
		document.addEventListener("mousedown", away);
		document.addEventListener("keydown", esc);
		return () => {
			document.removeEventListener("mousedown", away);
			document.removeEventListener("keydown", esc);
		};
	}, [open]);

	const first = new Date(month.getFullYear(), month.getMonth(), 1);
	const lead = (first.getDay() + 6) % 7; // weeks start on Monday
	const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
	const today = isoDay(new Date());
	const shift = (n: number) =>
		setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
	const pick = (iso: string) => {
		onChange(iso);
		setOpen(false);
	};
	const nav =
		"flex size-7 items-center justify-center rounded-full text-ink2 hover:bg-hover";

	return (
		<span ref={root} className="relative inline-block">
			<button
				type="button"
				aria-label={label}
				aria-expanded={open}
				onClick={() => {
					setMonth(fromIso(value || today));
					setOpen((v) => !v);
				}}
				className={`flex min-h-7 items-center gap-1.5 rounded-xl px-2 hover:bg-hover ${value ? "" : "text-mute"} ${className}`}
			>
				{value
					? fromIso(value).toLocaleDateString("en-GB", {
							day: "numeric",
							month: "short",
							year: "numeric",
						})
					: "Pick a date"}
				<Icon name="today" size={13} className="text-mute" />
			</button>
			{open ? (
				<div
					role="dialog"
					aria-label={`${label}: choose a day`}
					className="absolute top-full left-0 z-30 mt-1 w-[264px] rounded-2xl border border-line bg-raised p-3 text-[13px] text-ink shadow-lg"
				>
					<div className="mb-2 flex items-center">
						<button
							type="button"
							aria-label="Previous month"
							onClick={() => shift(-1)}
							className={nav}
						>
							<Icon name="back" size={13} />
						</button>
						<span className="flex-1 text-center font-medium">
							{month.toLocaleDateString("en-GB", {
								month: "long",
								year: "numeric",
							})}
						</span>
						<button
							type="button"
							aria-label="Next month"
							onClick={() => shift(1)}
							className={nav}
						>
							<Icon name="forward" size={13} />
						</button>
					</div>
					<div className="grid grid-cols-7 gap-y-0.5 text-center">
						{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
							<span key={d} title={d} className="py-1 text-[11px] text-mute">
								{d[0]}
							</span>
						))}
						{Array.from({ length: days }, (_, i) => {
							const iso = isoDay(
								new Date(month.getFullYear(), month.getMonth(), i + 1),
							);
							const chosen = iso === value;
							return (
								<button
									key={iso}
									type="button"
									aria-pressed={chosen}
									aria-label={iso}
									style={i === 0 ? { gridColumnStart: lead + 1 } : undefined}
									onClick={() => pick(iso)}
									className={`mx-auto size-8 rounded-full ${chosen ? "bg-accent text-paper" : iso === today ? "text-accent ring-1 ring-accent/50 hover:bg-hover" : "hover:bg-hover"}`}
								>
									{i + 1}
								</button>
							);
						})}
					</div>
					<div className="mt-2 flex justify-between border-t border-line2 pt-2 text-ink2">
						<button
							type="button"
							onClick={() => pick(today)}
							className="rounded-xl px-2 py-1 hover:bg-hover"
						>
							Today
						</button>
						{value ? (
							<button
								type="button"
								onClick={() => pick("")}
								className="rounded-xl px-2 py-1 hover:bg-hover"
							>
								Clear
							</button>
						) : null}
					</div>
				</div>
			) : null}
		</span>
	);
}
