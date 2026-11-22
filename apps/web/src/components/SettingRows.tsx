import type { ReactNode } from "react";
import { Listbox } from "./Listbox";

/** Rows and controls for the Settings dialog, following the mockup's "Settings" boards. */

export function Group({
	name,
	children,
}: {
	name: string;
	children: ReactNode;
}) {
	return (
		<section className="flex flex-col">
			<h3 className="pt-[18px] pb-1 text-xs font-semibold tracking-[0.08em] text-mute uppercase">
				{name}
			</h3>
			{children}
		</section>
	);
}

export function Row({
	label,
	desc,
	note,
	children,
}: {
	label: string;
	desc?: string;
	/** Quiet text beside the control, such as "Synced 2 minutes ago". */
	note?: string;
	children: ReactNode;
}) {
	return (
		<div className="flex min-h-14 flex-col gap-2.5 border-b border-line2 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
			<div className="flex min-w-0 flex-col gap-0.5">
				<span className="text-sm font-medium">{label}</span>
				{desc ? (
					<span className="text-[13px] leading-[1.4] text-mute">{desc}</span>
				) : null}
			</div>
			<div className="flex flex-none flex-wrap items-center gap-3">
				{note ? <span className="text-[13px] text-mute">{note}</span> : null}
				{children}
			</div>
		</div>
	);
}

const DISABLED = "disabled:cursor-default disabled:opacity-50";

export function Toggle({
	label,
	on,
	onChange,
	disabled,
}: {
	label: string;
	on: boolean;
	onChange: (v: boolean) => void;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={on}
			aria-label={label}
			disabled={disabled}
			onClick={() => onChange(!on)}
			className={`relative h-6 w-[42px] flex-none rounded-full ${on ? "bg-accent" : "bg-off"} ${DISABLED}`}
		>
			<span
				aria-hidden
				className={`absolute top-[3px] size-[18px] rounded-full bg-[#fcfaf4] shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-[left] ${on ? "left-[21px]" : "left-[3px]"}`}
			/>
		</button>
	);
}

export function Select<T extends string>({
	label,
	value,
	options,
	labels,
	onChange,
	disabled,
}: {
	label: string;
	value: T;
	options: readonly T[];
	/** Text shown for each option; the stored value stays as it is. */
	labels?: Partial<Record<T, string>>;
	onChange: (v: T) => void;
	disabled?: boolean;
}) {
	return (
		<Listbox
			label={label}
			value={value}
			disabled={disabled}
			onChange={(v) => onChange(v as T)}
			options={options.map((o) => ({ value: o, label: labels?.[o] ?? o }))}
			className="h-9 border border-line bg-raised px-3.5 text-[13px] text-ink"
		/>
	);
}

export function Segmented<T extends string>({
	label,
	value,
	options,
	labels,
	onChange,
}: {
	label: string;
	value: T;
	options: readonly T[];
	labels?: Record<T, string>;
	onChange: (v: T) => void;
}) {
	return (
		<div
			role="radiogroup"
			aria-label={label}
			className="flex gap-0.5 rounded-2xl bg-tag p-[3px]"
		>
			{options.map((o) => {
				const on = o === value;
				return (
					// biome-ignore lint/a11y/useSemanticElements: styled button radios inside a radiogroup
					<button
						type="button"
						key={o}
						role="radio"
						aria-checked={on}
						onClick={() => onChange(o)}
						className={`h-[30px] rounded-full px-3.5 text-[13px] ${on ? "bg-raised font-semibold text-ink shadow-[0_0_0_1px_var(--line)]" : "font-medium text-ink2 hover:text-ink"}`}
					>
						{labels?.[o] ?? o}
					</button>
				);
			})}
		</div>
	);
}

export function Swatches<T extends string>({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: T;
	options: { id: T; label: string; color: string }[];
	onChange: (v: T) => void;
}) {
	return (
		<div role="radiogroup" aria-label={label} className="flex gap-2.5">
			{options.map((o) => {
				const on = o.id === value;
				return (
					// biome-ignore lint/a11y/useSemanticElements: styled button radios inside a radiogroup
					<button
						type="button"
						key={o.id}
						role="radio"
						aria-checked={on}
						aria-label={o.label}
						title={o.label}
						onClick={() => onChange(o.id)}
						style={{ background: o.color }}
						className={`size-7 rounded-full border-2 shadow-[inset_0_0_0_2px_var(--paper)] ${on ? "border-ink" : "border-transparent"}`}
					/>
				);
			})}
		</div>
	);
}

export function Range({
	label,
	value,
	min,
	max,
	onChange,
}: {
	label: string;
	value: number;
	min: number;
	max: number;
	onChange: (v: number) => void;
}) {
	return (
		<div className="flex items-center gap-3.5">
			<span aria-hidden className="text-xs text-mute">
				A
			</span>
			<input
				type="range"
				aria-label={label}
				min={min}
				max={max}
				step={1}
				value={value}
				onChange={(e) => onChange(Number(e.target.value))}
				style={
					{
						"--fill": `${((value - min) / (max - min)) * 100}%`,
					} as React.CSSProperties
				}
				className="w-[170px]"
			/>
			<span aria-hidden className="text-base text-mute">
				A
			</span>
			<span className="w-9 text-right text-[13px] text-ink2">{value}px</span>
		</div>
	);
}

export function Btn({
	children,
	onClick,
	danger,
	disabled,
	title,
}: {
	children: ReactNode;
	onClick?: () => void;
	danger?: boolean;
	disabled?: boolean;
	title?: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			title={title}
			className={`h-9 rounded-full border bg-raised px-4 text-[13px] font-medium hover:bg-hover ${DISABLED} ${danger ? "border-accent text-accent" : "border-line text-ink"}`}
		>
			{children}
		</button>
	);
}

export function TextField({
	label,
	value,
	onChange,
	placeholder,
	disabled,
	width = "w-60",
	onCommit,
}: {
	label: string;
	value: string;
	onChange: (v: string) => void;
	/** Called when the field loses focus or Enter is pressed. */
	onCommit?: () => void;
	placeholder?: string;
	disabled?: boolean;
	width?: string;
}) {
	return (
		<input
			type="text"
			aria-label={label}
			value={value}
			placeholder={placeholder}
			disabled={disabled}
			spellCheck={false}
			autoComplete="off"
			onChange={(e) => onChange(e.target.value)}
			onBlur={onCommit}
			onKeyDown={(e) => {
				if (e.key === "Enter") onCommit?.();
			}}
			className={`h-9 max-w-full min-w-0 ${width} rounded-full border border-line bg-raised px-3.5 text-[13px] text-ink outline-none placeholder:text-mute focus:border-mute ${DISABLED}`}
		/>
	);
}

export function Keys({ keys }: { keys: string[] }) {
	return (
		<div className="flex gap-1.5">
			{keys.map((k) => (
				<kbd
					key={k}
					className="flex h-7 min-w-7 items-center justify-center rounded-full border border-b-2 border-line bg-raised px-2 font-mono text-xs text-ink2"
				>
					{k}
				</kbd>
			))}
		</div>
	);
}
