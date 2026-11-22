import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./Icon";

export interface ListOption {
	value: string;
	label: string;
	/** Options with the same group are shown under one small heading. */
	group?: string;
}

/**
 * A dropdown in the app's own style, in place of the browser's <select> (whose open list is drawn
 * by the OS). Arrow keys move, Enter or Space picks, Escape closes.
 */
export function Listbox({
	label,
	value,
	options,
	onChange,
	disabled,
	className = "",
}: {
	label: string;
	value: string;
	options: ListOption[];
	onChange: (value: string) => void;
	disabled?: boolean;
	/** Size, border and background of the closed button. */
	className?: string;
}) {
	const id = useId();
	const button = useRef<HTMLButtonElement>(null);
	const panel = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(0);
	const [box, setBox] = useState<{
		left: number;
		top: number;
		width: number;
		up: boolean;
	}>();
	const selected = options.findIndex((o) => o.value === value);

	const show = () => {
		const r = button.current?.getBoundingClientRect();
		if (!r) return;
		const up = innerHeight - r.bottom < 280 && r.top > innerHeight - r.bottom;
		setBox({
			left: r.left,
			top: up ? r.top - 4 : r.bottom + 4,
			width: r.width,
			up,
		});
		setActive(Math.max(selected, 0));
		setOpen(true);
	};
	const pick = (i: number) => {
		const o = options[i];
		if (o) onChange(o.value);
		setOpen(false);
		button.current?.focus();
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: pick only reads props that change with options
	useEffect(() => {
		if (!open) return;
		const away = (e: PointerEvent) => {
			if (
				!panel.current?.contains(e.target as Node) &&
				!button.current?.contains(e.target as Node)
			)
				setOpen(false);
		};
		const close = () => setOpen(false);
		// The list scrolling itself (to keep the highlighted row in view) must not close it.
		const outside = (e: Event) => {
			if (!panel.current?.contains(e.target as Node)) close();
		};
		const keys = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				// Settings and dialogs listen for Escape too; this closes only the list.
				e.stopImmediatePropagation();
				setOpen(false);
				button.current?.focus();
			} else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				setActive((a) =>
					Math.min(
						options.length - 1,
						Math.max(0, a + (e.key === "ArrowDown" ? 1 : -1)),
					),
				);
			} else if (e.key === "Home" || e.key === "End") {
				e.preventDefault();
				setActive(e.key === "Home" ? 0 : options.length - 1);
			} else if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				pick(active);
			} else if (e.key === "Tab") setOpen(false);
		};
		document.addEventListener("pointerdown", away);
		window.addEventListener("resize", close);
		window.addEventListener("keydown", keys, true);
		document.addEventListener("scroll", outside, true);
		return () => {
			document.removeEventListener("pointerdown", away);
			window.removeEventListener("resize", close);
			window.removeEventListener("keydown", keys, true);
			document.removeEventListener("scroll", outside, true);
		};
	}, [open, active, options]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `active` is the trigger to keep the highlighted row in view
	useEffect(() => {
		if (open)
			panel.current
				?.querySelector('[data-active="true"]')
				?.scrollIntoView({ block: "nearest" });
	}, [open, active]);

	let lastGroup: string | undefined;
	return (
		<>
			<button
				ref={button}
				type="button"
				role="combobox"
				aria-label={label}
				aria-expanded={open}
				aria-haspopup="listbox"
				aria-controls={open ? id : undefined}
				disabled={disabled}
				onClick={() => (open ? setOpen(false) : show())}
				onKeyDown={(e) => {
					if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
						e.preventDefault();
						show();
					}
				}}
				className={`inline-flex cursor-pointer items-center gap-2 rounded-full text-left outline-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-mute disabled:cursor-default disabled:opacity-50 ${className}`}
			>
				<span className="min-w-0 flex-1 truncate">
					{options[selected]?.label ?? ""}
				</span>
				<Icon
					name="down"
					size={12}
					className={`flex-none text-mute transition-transform ${open ? "rotate-180" : ""}`}
				/>
			</button>
			{open && box ? (
				<div
					ref={panel}
					id={id}
					role="listbox"
					aria-label={label}
					style={{
						left: box.left,
						top: box.top,
						minWidth: box.width,
						transform: box.up ? "translateY(-100%)" : undefined,
					}}
					className="fixed z-[80] max-h-64 max-w-[min(320px,calc(100vw-16px))] overflow-y-auto rounded-2xl border border-line bg-raised p-1 shadow-[0_12px_32px_rgba(40,30,15,0.2),0_2px_6px_rgba(40,30,15,0.1)]"
				>
					{options.map((o, i) => {
						const heading = o.group && o.group !== lastGroup ? o.group : null;
						lastGroup = o.group;
						return (
							<div key={o.value}>
								{heading ? (
									<div className="px-3 pt-2 pb-1 text-[11px] font-medium tracking-[0.09em] text-mute uppercase">
										{heading}
									</div>
								) : null}
								<div
									role="option"
									tabIndex={-1}
									aria-selected={i === selected}
									data-active={i === active}
									onPointerEnter={() => setActive(i)}
									onClick={() => pick(i)}
									onKeyDown={() => {}}
									className={`flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-[13px] text-ink ${i === active ? "bg-hover" : ""}`}
								>
									<span className="min-w-0 flex-1 truncate">{o.label}</span>
									{i === selected ? (
										<Icon
											name="check"
											size={13}
											className="flex-none text-accent"
										/>
									) : null}
								</div>
							</div>
						);
					})}
				</div>
			) : null}
		</>
	);
}
