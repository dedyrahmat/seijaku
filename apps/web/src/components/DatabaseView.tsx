import {
	addFilter,
	addOption,
	addProp,
	type Cell,
	clearFilters,
	createNote,
	type DbFilter,
	type DbProp,
	type DbSchema,
	databaseRows,
	deleteProp,
	FILTER_OPS,
	type FilterOp,
	type NoteMeta,
	OPS_FOR,
	PROP_TYPES,
	type PropType,
	removeFilter,
	type SelectOption,
	setCell,
	setHidden,
	setSort,
	TITLE_PROP,
	updateFilter,
	updateProp,
} from "@seijaku/sync";
import { Link } from "@tanstack/react-router";
import {
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { workspace } from "../workspace/store";
import { DatePicker } from "./DatePicker";
import { askConfirm } from "./Dialogs";
import { Icon } from "./Icon";
import { pageLink } from "./pageLink";
import { Select } from "./SettingRows";
import { TINTS, tintVar } from "./tints";

/**
 * A database page: its sub-pages as a table (cards on a phone) with typed properties, one
 * sort and any number of filters. The model is in packages/sync/src/database.ts; this is only
 * the drawing and the clicks.
 */

const doc = () => workspace.index;

/** A button that opens a small panel under it; the panel closes on Escape or a click away. */
function Pop({
	label,
	trigger,
	children,
	className = "",
	width = 260,
}: {
	label: string;
	trigger: ReactNode;
	children: (close: () => void) => ReactNode;
	className?: string;
	width?: number;
}) {
	const [open, setOpen] = useState(false);
	const [at, setAt] = useState({ left: 0, top: 0 });
	const button = useRef<HTMLButtonElement>(null);
	const panel = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		if (!open) return;
		const r = button.current?.getBoundingClientRect();
		if (!r) return;
		setAt({
			left: Math.max(8, Math.min(r.left, innerWidth - width - 8)),
			top: r.bottom + 4,
		});
	}, [open, width]);

	useEffect(() => {
		if (!open) return;
		const away = (e: PointerEvent) => {
			if (
				!panel.current?.contains(e.target as Node) &&
				!button.current?.contains(e.target as Node)
			)
				setOpen(false);
		};
		const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
		document.addEventListener("pointerdown", away);
		document.addEventListener("keydown", esc);
		return () => {
			document.removeEventListener("pointerdown", away);
			document.removeEventListener("keydown", esc);
		};
	}, [open]);

	return (
		<>
			<button
				ref={button}
				type="button"
				aria-label={label}
				aria-expanded={open}
				aria-haspopup="dialog"
				onClick={() => setOpen((v) => !v)}
				className={className}
			>
				{trigger}
			</button>
			{open ? (
				<div
					ref={panel}
					role="dialog"
					aria-label={label}
					style={{ left: at.left, top: at.top, width }}
					className="fixed z-50 max-h-[70dvh] overflow-y-auto rounded-2xl border border-line bg-raised p-1.5 shadow-lg"
				>
					{children(() => setOpen(false))}
				</div>
			) : null}
		</>
	);
}

const item =
	"flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] text-ink hover:bg-hover";
const heading =
	"px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-[0.08em] text-mute uppercase";
const field =
	"h-[34px] min-w-0 rounded-[10px] border border-line bg-paper px-2.5 text-[13px] text-ink placeholder:text-mute";
const pill =
	"inline-flex h-[30px] items-center gap-1.5 rounded-full border border-line bg-raised px-3 text-[13px] text-ink2 hover:bg-hover";

function OptionTag({ option }: { option: SelectOption | undefined }) {
	if (!option) return null;
	return (
		<span
			className="inline-block max-w-full truncate rounded-[10px] px-2.5 py-px text-xs text-ink"
			style={{ background: tintVar(TINTS[option.tint % TINTS.length]) }}
		>
			{option.label}
		</span>
	);
}

/** One cell of one row, edited in place. Used by the table, the phone cards and a row's own page. */
export function CellEditor({
	dbId,
	prop,
	row,
}: {
	dbId: string;
	prop: DbProp;
	row: NoteMeta;
}) {
	const { t } = useTranslation();
	const value = row.cells[prop.id] ?? null;
	const put = (v: Cell) => setCell(doc(), row.id, prop.id, v);
	const [text, setText] = useState(value === null ? "" : String(value));
	useEffect(() => setText(value === null ? "" : String(value)), [value]);

	if (prop.type === "checkbox")
		return (
			<button
				type="button"
				aria-pressed={Boolean(value)}
				aria-label={prop.name}
				onClick={() => put(!value)}
				className={`inline-flex size-[18px] items-center justify-center rounded-[5px] border-[1.5px] ${value ? "border-ink bg-ink text-paper" : "border-ink2"}`}
			>
				{value ? <Icon name="check" size={12} /> : null}
			</button>
		);
	if (prop.type === "date")
		return (
			<DatePicker
				label={prop.name}
				value={typeof value === "string" ? value : ""}
				onChange={(iso) => put(iso || null)}
				className="text-[13.5px]"
			/>
		);
	if (prop.type === "select")
		return (
			<SelectCell
				dbId={dbId}
				prop={prop}
				value={typeof value === "string" ? value : null}
				onPick={put}
			/>
		);
	const commit = () => {
		if (prop.type === "number") {
			const n = Number(text.replace(",", "."));
			put(text.trim() === "" || Number.isNaN(n) ? null : n);
			if (Number.isNaN(n)) setText(value === null ? "" : String(value));
		} else put(text);
	};
	return (
		<input
			type="text"
			inputMode={prop.type === "number" ? "decimal" : undefined}
			aria-label={prop.name}
			placeholder={t("db.empty")}
			value={text}
			onChange={(e) => setText(e.target.value)}
			onBlur={commit}
			onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
			className="w-full min-w-[4rem] bg-transparent text-[13.5px] text-ink outline-none placeholder:text-transparent focus:placeholder:text-mute"
		/>
	);
}

function SelectCell({
	dbId,
	prop,
	value,
	onPick,
}: {
	dbId: string;
	prop: DbProp;
	value: string | null;
	onPick: (v: Cell) => void;
}) {
	const { t } = useTranslation();
	const [q, setQ] = useState("");
	const current = prop.options.find((o) => o.id === value);
	const shown = prop.options.filter((o) =>
		o.label.toLowerCase().includes(q.trim().toLowerCase()),
	);
	const exact = prop.options.some(
		(o) => o.label.toLowerCase() === q.trim().toLowerCase(),
	);
	return (
		<Pop
			label={prop.name}
			width={240}
			className="flex min-h-[26px] w-full items-center text-left"
			trigger={
				current ? (
					<OptionTag option={current} />
				) : (
					<span className="text-mute/0 hover:text-mute">{t("db.empty")}</span>
				)
			}
		>
			{(close) => (
				<>
					{shown.map((o) => (
						<button
							key={o.id}
							type="button"
							onClick={() => {
								onPick(o.id === value ? null : o.id);
								close();
							}}
							className={item}
						>
							<OptionTag option={o} />
							{o.id === value ? (
								<Icon name="check" size={13} className="ml-auto" />
							) : null}
						</button>
					))}
					<input
						value={q}
						onChange={(e) => setQ(e.target.value)}
						placeholder={t("db.findOption")}
						aria-label={t("db.findOption")}
						// biome-ignore lint/a11y/noAutofocus: the panel was opened to type into
						autoFocus
						onKeyDown={(e) => {
							if (e.key !== "Enter" || !q.trim()) return;
							const id = exact
								? prop.options.find(
										(o) => o.label.toLowerCase() === q.trim().toLowerCase(),
									)?.id
								: addOption(doc(), dbId, prop.id, q);
							if (id) onPick(id);
							close();
						}}
						className={`${field} my-1 w-full`}
					/>
					{q.trim() && !exact ? (
						<button
							type="button"
							onClick={() => {
								const id = addOption(doc(), dbId, prop.id, q);
								if (id) onPick(id);
								close();
							}}
							className={item}
						>
							<Icon name="plus" size={13} />
							{t("db.createOption", { label: q.trim() })}
						</button>
					) : null}
				</>
			)}
		</Pop>
	);
}

function FilterRow({
	db,
	schema,
	f,
}: {
	db: NoteMeta;
	schema: DbSchema;
	f: DbFilter;
}) {
	const { t } = useTranslation();
	const prop = schema.props.find((p) => p.id === f.prop);
	const type = f.prop === TITLE_PROP ? "title" : (prop?.type ?? "text");
	const ops = OPS_FOR[type as keyof typeof OPS_FOR];
	const set = (patch: Partial<Omit<DbFilter, "id">>) =>
		updateFilter(doc(), db.id, f.id, patch);
	const [text, setText] = useState(f.value === null ? "" : String(f.value));
	const names = [
		{ id: TITLE_PROP, name: t("db.name") },
		...schema.props.map((p) => ({ id: p.id, name: p.name })),
	];
	let editor: ReactNode;
	if (type === "checkbox")
		editor = (
			<Select
				label={t("db.value")}
				value={f.value === false ? "no" : "yes"}
				options={["yes", "no"]}
				labels={{ yes: t("db.op.checked"), no: t("db.op.unchecked") }}
				onChange={(v) => set({ value: v === "yes" })}
			/>
		);
	else if (type === "select")
		editor = (
			<Select
				label={t("db.value")}
				value={typeof f.value === "string" ? f.value : ""}
				options={["", ...(prop?.options.map((o) => o.id) ?? [])]}
				labels={Object.fromEntries([
					["", "–"],
					...(prop?.options.map((o) => [o.id, o.label]) ?? []),
				])}
				onChange={(v) => set({ value: v || null })}
			/>
		);
	else if (type === "date")
		editor = (
			<DatePicker
				label={t("db.value")}
				value={typeof f.value === "string" ? f.value : ""}
				onChange={(iso) => set({ value: iso || null })}
			/>
		);
	else
		editor = (
			<input
				value={text}
				inputMode={type === "number" ? "decimal" : undefined}
				aria-label={t("db.value")}
				// Applied as you type: the panel can close before a blur would fire.
				onChange={(e) => {
					const v = e.target.value;
					setText(v);
					set({
						value:
							type === "number"
								? v.trim() === "" || Number.isNaN(Number(v.replace(",", ".")))
									? null
									: Number(v.replace(",", "."))
								: v,
					});
				}}
				className={`${field} w-28`}
			/>
		);
	return (
		<div className="flex flex-wrap items-center gap-1.5 px-1 py-1.5">
			<Select
				label={t("db.filterProp")}
				value={f.prop}
				options={names.map((n) => n.id)}
				labels={Object.fromEntries(names.map((n) => [n.id, n.name]))}
				onChange={(id) => {
					const nt =
						id === TITLE_PROP
							? "title"
							: (schema.props.find((p) => p.id === id)?.type ?? "text");
					set({
						prop: id,
						op: OPS_FOR[nt as keyof typeof OPS_FOR][0] ?? "contains",
						value: nt === "checkbox" ? true : null,
					});
				}}
			/>
			{type === "checkbox" ? null : (
				<Select
					label={t("db.filterOp")}
					value={f.op}
					options={ops}
					labels={Object.fromEntries(ops.map((o) => [o, t(`db.op.${o}`)]))}
					onChange={(op) => set({ op })}
				/>
			)}
			{editor}
			<button
				type="button"
				aria-label={t("common.remove")}
				onClick={() => removeFilter(doc(), db.id, f.id)}
				className="ml-auto flex size-8 items-center justify-center rounded-full text-mute hover:bg-hover"
			>
				<Icon name="close" size={13} />
			</button>
		</div>
	);
}

function Toolbar({
	db,
	schema,
	hiddenRows,
}: {
	db: NoteMeta;
	schema: DbSchema;
	hiddenRows: number;
}) {
	const { t } = useTranslation();
	const { sort, filters } = schema.view;
	const cols = [
		{ id: TITLE_PROP, name: t("db.name") },
		...schema.props.map((p) => ({ id: p.id, name: p.name })),
	];
	const sortName = cols.find((c) => c.id === sort?.prop)?.name;
	return (
		<div className="my-3 flex flex-wrap items-center gap-2">
			<Pop
				label={t("db.sort")}
				className={pill}
				trigger={
					sortName
						? `${t("db.sort")} · ${sortName} ${sort?.dir === "desc" ? "↓" : "↑"}`
						: t("db.sort")
				}
			>
				{(close) => (
					<>
						<div className={heading}>{t("db.sortBy")}</div>
						{cols.map((c) => (
							<button
								key={c.id}
								type="button"
								className={item}
								onClick={() => {
									setSort(doc(), db.id, { prop: c.id, dir: "asc" });
									close();
								}}
							>
								<span className="w-4">
									{sort?.prop === c.id ? <Icon name="check" size={13} /> : null}
								</span>
								{c.name}
								{sort?.prop === c.id ? (
									<span className="ml-auto text-xs text-mute">
										{sort.dir === "desc" ? t("db.za") : t("db.az")}
									</span>
								) : null}
							</button>
						))}
						{sort ? (
							<>
								<div className="my-1 border-t border-line2" />
								<button
									type="button"
									className={item}
									onClick={() => {
										setSort(doc(), db.id, {
											...sort,
											dir: sort.dir === "asc" ? "desc" : "asc",
										});
										close();
									}}
								>
									{t("db.reverse")}
								</button>
								<button
									type="button"
									className={item}
									onClick={() => {
										setSort(doc(), db.id, null);
										close();
									}}
								>
									{t("db.sortNone")}
								</button>
							</>
						) : null}
					</>
				)}
			</Pop>
			<Pop
				label={t("db.filter")}
				width={420}
				className={`${pill} ${filters.length ? "border-ink text-ink" : ""}`}
				trigger={
					filters.length
						? t("db.filterN", { count: filters.length })
						: t("db.filter")
				}
			>
				{() => (
					<>
						<div className={heading}>{t("db.filter")}</div>
						{filters.map((f) => (
							<FilterRow key={f.id} db={db} schema={schema} f={f} />
						))}
						<button
							type="button"
							className={item}
							onClick={() =>
								addFilter(doc(), db.id, {
									prop: TITLE_PROP,
									op: "contains",
									value: null,
								})
							}
						>
							<Icon name="plus" size={13} />
							{t("db.addFilter")}
						</button>
						{filters.length ? (
							<button
								type="button"
								className={item}
								onClick={() => clearFilters(doc(), db.id)}
							>
								{t("db.clearFilters")}
							</button>
						) : null}
					</>
				)}
			</Pop>
			<Pop
				label={t("db.properties")}
				className={pill}
				trigger={t("db.properties")}
			>
				{(close) => (
					<>
						<div className={heading}>{t("db.properties")}</div>
						{schema.props.map((p) => {
							const hidden = schema.view.hidden.includes(p.id);
							return (
								<div key={p.id} className="flex items-center">
									<button
										type="button"
										className={item}
										onClick={() => setHidden(doc(), db.id, p.id, !hidden)}
									>
										<span className="w-4">
											{hidden ? null : <Icon name="check" size={13} />}
										</span>
										{p.name}
										{hidden ? (
											<span className="ml-auto text-xs text-mute">
												{t("db.hidden")}
											</span>
										) : null}
									</button>
									<button
										type="button"
										aria-label={t("db.delete", { name: p.name })}
										className="flex size-8 flex-none items-center justify-center rounded-full text-mute hover:bg-hover"
										onClick={async () => {
											close();
											if (
												await askConfirm(
													t("db.deleteConfirm", { name: p.name }),
													{ confirm: t("db.deleteBtn"), danger: true },
												)
											)
												deleteProp(doc(), db.id, p.id);
										}}
									>
										<Icon name="trash" size={13} />
									</button>
								</div>
							);
						})}
					</>
				)}
			</Pop>
			<span className="flex-1" />
			{hiddenRows > 0 ? (
				<span className="text-xs text-mute">
					{t("db.hiddenRows", { count: hiddenRows })}
				</span>
			) : null}
			<button
				type="button"
				className={pill}
				onClick={() => createNote(doc(), { parentId: db.id })}
			>
				<Icon name="plus" size={13} />
				{t("db.newRow")}
			</button>
		</div>
	);
}

function AddProperty({
	db,
	labelled = false,
}: {
	db: NoteMeta;
	labelled?: boolean;
}) {
	const { t } = useTranslation();
	const [name, setName] = useState("");
	return (
		<Pop
			label={t("db.newProp")}
			className={`flex items-center gap-1.5 rounded-full text-mute hover:bg-hover ${labelled ? "h-7 px-2 text-[13px]" : "size-7 justify-center"}`}
			trigger={
				<>
					<Icon name="plus" size={14} />
					{labelled ? t("db.addProperty") : null}
				</>
			}
			width={260}
		>
			{(close) => (
				<>
					<div className={heading}>{t("db.newProp")}</div>
					<input
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder={t("db.name")}
						aria-label={t("db.name")}
						// biome-ignore lint/a11y/noAutofocus: the panel was opened to type into
						autoFocus
						className={`${field} mx-1 mb-1 w-[calc(100%-0.5rem)]`}
					/>
					{PROP_TYPES.map((type) => (
						<button
							key={type}
							type="button"
							className={item}
							onClick={() => {
								addProp(doc(), db.id, {
									name: name.trim() || t(`db.type.${type}`),
									type,
								});
								setName("");
								close();
							}}
						>
							{t(`db.type.${type}`)}
							{type === "select" ? (
								<span className="ml-auto text-xs text-mute">
									{t("db.typeSelectHint")}
								</span>
							) : null}
						</button>
					))}
				</>
			)}
		</Pop>
	);
}

function HeaderCell({ db, prop }: { db: NoteMeta; prop: DbProp }) {
	const { t } = useTranslation();
	const [name, setName] = useState(prop.name);
	useEffect(() => setName(prop.name), [prop.name]);
	return (
		<Pop
			label={prop.name}
			width={240}
			className="text-left font-semibold tracking-[0.07em] uppercase hover:text-ink"
			trigger={prop.name}
		>
			{(close) => (
				<>
					<input
						value={name}
						aria-label={t("db.name")}
						onChange={(e) => setName(e.target.value)}
						onBlur={() =>
							name.trim() && updateProp(doc(), db.id, prop.id, { name })
						}
						onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
						className={`${field} mx-1 mb-1 w-[calc(100%-0.5rem)]`}
					/>
					<button
						type="button"
						className={item}
						onClick={() => {
							setHidden(doc(), db.id, prop.id, true);
							close();
						}}
					>
						{t("db.hideCol")}
					</button>
					<button
						type="button"
						className={`${item} text-accent`}
						onClick={async () => {
							close();
							if (
								await askConfirm(t("db.deleteConfirm", { name: prop.name }), {
									confirm: t("db.deleteBtn"),
									danger: true,
								})
							)
								deleteProp(doc(), db.id, prop.id);
						}}
					>
						{t("db.delete", { name: prop.name })}
					</button>
				</>
			)}
		</Pop>
	);
}

/** The table (or cards) under a database page's title. */
export function DatabaseView({
	db,
	notes,
}: {
	db: NoteMeta;
	notes: NoteMeta[];
}) {
	const { t } = useTranslation();
	const schema = db.schema;
	if (!schema) return null;
	const { rows, hidden } = databaseRows(notes, db.id, schema);
	const shown = schema.props.filter((p) => !schema.view.hidden.includes(p.id));
	return (
		<section aria-label={db.title || t("common.untitled")}>
			<Toolbar db={db} schema={schema} hiddenRows={hidden} />
			{rows.length === 0 ? (
				<p className="py-6 text-sm text-mute">{t("db.noRows")}</p>
			) : null}

			<div className="hidden overflow-x-auto md:block">
				<table className="w-full border-collapse text-[13.5px]">
					<thead>
						<tr className="text-xs text-mute">
							<th className="border-b border-line px-2.5 py-2 text-left font-semibold tracking-[0.07em] whitespace-nowrap uppercase">
								{t("db.name")}
							</th>
							{shown.map((p) => (
								<th
									key={p.id}
									className="border-b border-line px-2.5 py-2 text-left whitespace-nowrap"
								>
									<HeaderCell db={db} prop={p} />
								</th>
							))}
							<th className="w-10 border-b border-line px-1 text-left">
								<AddProperty db={db} />
							</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr key={row.id} className="group">
								<td className="w-[34%] border-b border-line px-2.5 py-2 font-serif text-[15px] font-medium">
									<Link
										{...pageLink(row.id, row.title)}
										className="hover:underline"
									>
										{row.title || t("common.untitled")}
									</Link>
								</td>
								{shown.map((p) => (
									<td key={p.id} className="border-b border-line px-2.5 py-2">
										<CellEditor dbId={db.id} prop={p} row={row} />
									</td>
								))}
								<td className="border-b border-line" />
							</tr>
						))}
					</tbody>
				</table>
			</div>

			<ul className="flex flex-col gap-2.5 md:hidden">
				{rows.map((row) => (
					<li
						key={row.id}
						className="rounded-xl border border-line bg-raised px-3.5 py-3"
					>
						<Link
							{...pageLink(row.id, row.title)}
							className="mb-2 block font-serif text-base font-medium"
						>
							{row.title || t("common.untitled")}
						</Link>
						<div className="flex flex-col gap-1.5">
							{shown.map((p) => (
								<div key={p.id} className="flex items-center gap-3 text-[13px]">
									<span className="w-24 flex-none text-mute">{p.name}</span>
									<span className="min-w-0 flex-1">
										<CellEditor dbId={db.id} prop={p} row={row} />
									</span>
								</div>
							))}
						</div>
					</li>
				))}
				<li className="flex justify-end">
					<AddProperty db={db} />
				</li>
			</ul>
		</section>
	);
}

/** The properties of a row, above its text; null when the page is not inside a database. */
export function RowProps({
	note,
	notes,
}: {
	note: NoteMeta;
	notes: NoteMeta[];
}) {
	const { t } = useTranslation();
	const db = notes.find((n) => n.id === note.parentId);
	if (!db?.schema) return null;
	return (
		<div className="my-3 mb-5 grid grid-cols-[120px_1fr] items-center gap-x-3.5 gap-y-1.5 text-[13.5px]">
			{db.schema.props.map((p) => (
				<div key={p.id} className="contents">
					<span className="text-mute">{p.name}</span>
					<span className="min-h-[28px]">
						<CellEditor dbId={db.id} prop={p} row={note} />
					</span>
				</div>
			))}
			<span />
			<span>
				<AddProperty db={db} labelled />
			</span>
		</div>
	);
}

/** "Reading list ›" above a row's title, or "Database · N rows" above the database's own. */
export function DatabaseKicker({
	note,
	notes,
}: {
	note: NoteMeta;
	notes: NoteMeta[];
}) {
	const { t } = useTranslation();
	if (note.kind === "database") {
		const count = notes.filter(
			(n) => n.parentId === note.id && !n.trashed,
		).length;
		return (
			<div className="mb-1 font-mono text-[11px] tracking-[0.06em] text-mute uppercase">
				{t("db.kicker", { count })}
			</div>
		);
	}
	const db = notes.find((n) => n.id === note.parentId && n.kind === "database");
	if (!db) return null;
	return (
		<Link
			{...pageLink(db.id, db.title)}
			className="mb-1 inline-block font-mono text-[11px] tracking-[0.06em] text-mute uppercase hover:text-ink"
		>
			{db.title || t("common.untitled")} ›
		</Link>
	);
}

export type { PropType };
export { FILTER_OPS };
