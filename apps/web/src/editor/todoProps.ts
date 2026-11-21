import { defaultBlockSpecs } from "@blocknote/core";

/**
 * To-dos with a due date, a priority and an owner. The block keeps BlockNote's own type name and
 * everything else of its spec (parsing, Markdown export, shortcuts), so old notes, importers and
 * `openTodos` / `tickTodo` carry on; it only adds three props and a chip row.
 */

const iso = (d: Date) =>
	`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const plus = (n: number) => {
	const d = new Date();
	d.setDate(d.getDate() + n);
	return iso(d);
};

/** The coming Saturday (today, if it is one). */
const weekend = () => plus((6 - new Date().getDay() + 7) % 7);
const nextWeek = () => plus((8 - new Date().getDay()) % 7 || 7);

/** How a due date reads on a chip: Overdue and Today stand out, others show the day. */
export function dueLabel(due: string): { text: string; hot: boolean } {
	const today = iso(new Date());
	if (due < today) return { text: "Overdue", hot: true };
	if (due === today) return { text: "Today", hot: true };
	if (due === plus(1)) return { text: "Tomorrow", hot: false };
	const [y, m, d] = due.split("-").map(Number);
	return {
		text: new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).toLocaleDateString(
			"en-GB",
			{ day: "numeric", month: "short" },
		),
		hot: false,
	};
}

/** Names offered in the owner box (a meeting's attendees). Set by the editor of that note. */
let ownerNames: string[] = [];
export const setOwnerNames = (names: string[]) => {
	ownerNames = names;
};

interface TodoEditor {
	getBlock(
		id: string,
	): { id: string; props: Record<string, unknown> } | undefined;
	updateBlock(id: string, update: { props: Record<string, unknown> }): void;
}

let open: { close: () => void } | null = null;

function popover(anchor: HTMLElement, editor: TodoEditor, id: string) {
	open?.close();
	const props = () => editor.getBlock(id)?.props ?? {};
	const set = (p: Record<string, unknown>) => {
		editor.updateBlock(id, { props: p });
		close();
	};

	const root = document.createElement("div");
	root.className = "seijaku-todopop";
	root.setAttribute("role", "dialog");
	root.setAttribute("aria-label", "To-do details");

	const row = (label: string, ...kids: HTMLElement[]) => {
		const r = document.createElement("div");
		r.className = "seijaku-todopop__row";
		const l = document.createElement("span");
		l.textContent = label;
		r.append(l, ...kids);
		root.append(r);
	};
	const button = (text: string, on: () => void, pressed?: boolean) => {
		const b = document.createElement("button");
		b.type = "button";
		b.textContent = text;
		if (pressed !== undefined) b.setAttribute("aria-pressed", String(pressed));
		b.addEventListener("click", on);
		return b;
	};

	const due = String(props().due ?? "");
	const pick = document.createElement("input");
	pick.type = "date";
	pick.value = due;
	pick.setAttribute("aria-label", "Pick a date");
	pick.addEventListener("change", () => pick.value && set({ due: pick.value }));
	row(
		"Due",
		button("Today", () => set({ due: plus(0) })),
		button("Tomorrow", () => set({ due: plus(1) })),
		button("This weekend", () => set({ due: weekend() })),
		button("Next week", () => set({ due: nextWeek() })),
		pick,
	);
	if (due)
		row(
			"",
			button("No date", () => set({ due: "" })),
		);

	const high = props().priority === "high";
	row(
		"Priority",
		button("Normal", () => set({ priority: "normal" }), !high),
		button("High", () => set({ priority: "high" }), high),
	);

	const owner = document.createElement("input");
	owner.type = "text";
	owner.placeholder = "Owner";
	owner.value = String(props().owner ?? "");
	owner.setAttribute("aria-label", "Owner");
	const names = document.createElement("datalist");
	names.id = "seijaku-owner-names";
	for (const n of ownerNames) names.append(new Option(n));
	owner.setAttribute("list", names.id);
	owner.addEventListener("keydown", (e) => {
		e.stopPropagation();
		if (e.key === "Enter") set({ owner: owner.value.trim() });
		if (e.key === "Escape") close();
	});
	owner.addEventListener("change", () =>
		editor.updateBlock(id, { props: { owner: owner.value.trim() } }),
	);
	row("Owner", owner);
	root.append(names);

	const onDown = (e: MouseEvent) => {
		if (!root.contains(e.target as Node) && !anchor.contains(e.target as Node))
			close();
	};
	const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
	function close() {
		root.remove();
		document.removeEventListener("mousedown", onDown, true);
		document.removeEventListener("keydown", onKey, true);
		if (open?.close === close) open = null;
	}
	open = { close };
	document.body.append(root);
	const r = anchor.getBoundingClientRect();
	root.style.top = `${Math.min(r.bottom + 6, window.innerHeight - root.offsetHeight - 8)}px`;
	root.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - root.offsetWidth - 8))}px`;
	document.addEventListener("mousedown", onDown, true);
	document.addEventListener("keydown", onKey, true);
	(root.querySelector("button") as HTMLElement | null)?.focus();
}

const base = defaultBlockSpecs.checkListItem;
const baseRender = base.implementation.render as unknown as (
	this: unknown,
	block: unknown,
	editor: unknown,
) => { dom: DocumentFragment | HTMLElement; contentDOM?: HTMLElement };

/** BlockNote's checklist item plus `due`, `priority` and `owner`, drawn as chips after the text. */
export const checkListItemWithProps = {
	...base,
	config: {
		...base.config,
		propSchema: {
			...base.config.propSchema,
			due: { default: "" },
			priority: { default: "normal", values: ["normal", "high"] as const },
			owner: { default: "" },
		},
	},
	implementation: {
		...base.implementation,
		// biome-ignore lint/suspicious/noExplicitAny: the wrapped spec's types are internal to BlockNote
		render(this: unknown, block: any, editor: any) {
			// BlockNote calls render with its own context, which the wrapped render reads.
			const out = baseRender.call(this, block, editor);
			const chips = document.createElement("span");
			chips.className = "seijaku-todochips";
			chips.contentEditable = "false";
			const { due, priority, owner } = block.props as {
				due: string;
				priority: string;
				owner: string;
			};
			const chip = (text: string, cls = "") => {
				const c = document.createElement("span");
				c.className = `seijaku-todochip ${cls}`;
				c.textContent = text;
				chips.append(c);
			};
			if (due) {
				const l = dueLabel(due);
				chip(l.text, l.hot ? "seijaku-todochip--hot" : "");
			}
			if (priority === "high") chip("High", "seijaku-todochip--hot");
			if (owner) chip(owner);
			const edit = document.createElement("button");
			edit.type = "button";
			edit.className = "seijaku-todochips__edit";
			edit.textContent =
				due || priority === "high" || owner ? "Edit" : "Details";
			edit.setAttribute("aria-label", "Due date, priority and owner");
			edit.addEventListener("mousedown", (e) => e.preventDefault());
			edit.addEventListener("click", () => popover(edit, editor, block.id));
			chips.append(edit);
			(out.dom as DocumentFragment | HTMLElement).append(chips);
			return out;
		},
	},
} as typeof base;
