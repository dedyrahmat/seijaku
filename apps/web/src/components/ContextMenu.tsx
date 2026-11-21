import { useEffect, useState } from "react";

type Item = { label: string; run: () => void; divider?: boolean };
type Open = { x: number; y: number; items: Item[] };

const WIDTH = 208;
const ROW = 34;

const copyText = (text: string) => void navigator.clipboard?.writeText(text);

/** Items for whatever was right-clicked: link, selection, editable text, or the page itself. */
function itemsFor(target: Element): Item[] {
	const items: Item[] = [];
	const link = target.closest("a[href]") as HTMLAnchorElement | null;
	const field = target.closest("input, textarea, [contenteditable='true']");
	const editable = field !== null && !field.hasAttribute("readonly");
	const picked =
		field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement
			? (field.value ?? "").slice(
					field.selectionStart ?? 0,
					field.selectionEnd ?? 0,
				)
			: (window.getSelection()?.toString() ?? "");
	const exec = (cmd: string) => () => document.execCommand(cmd);

	if (link) {
		items.push(
			{ label: "Open link", run: () => link.click() },
			{ label: "Copy link address", run: () => copyText(link.href) },
		);
	}
	if (editable) {
		if (picked) items.push({ label: "Cut", run: exec("cut") });
		if (picked) items.push({ label: "Copy", run: exec("copy") });
		items.push(
			{
				label: "Paste",
				run: () =>
					void navigator.clipboard
						?.readText()
						.then((t) => document.execCommand("insertText", false, t))
						.catch(() => {}),
			},
			{ label: "Select all", run: exec("selectAll") },
		);
	} else if (picked) {
		items.push({ label: "Copy", run: exec("copy") });
	}
	if (!items.length) {
		items.push(
			{ label: "Back", run: () => history.back() },
			{ label: "Forward", run: () => history.forward() },
			{ label: "Reload", run: () => location.reload() },
		);
	} else {
		// Always leave a way to navigate, set apart from the item above.
		items.push({ label: "Back", run: () => history.back(), divider: true });
	}
	return items;
}

/**
 * Replaces the browser's right-click menu everywhere. Surfaces with their own menu
 * (sidebar rows) call preventDefault first and are left alone.
 */
export function ContextMenu() {
	const [menu, setMenu] = useState<Open | null>(null);

	useEffect(() => {
		const onMenu = (e: MouseEvent) => {
			if (e.defaultPrevented || !(e.target instanceof Element)) return;
			e.preventDefault();
			const items = itemsFor(e.target);
			setMenu({ x: e.clientX, y: e.clientY, items });
		};
		document.addEventListener("contextmenu", onMenu);
		return () => document.removeEventListener("contextmenu", onMenu);
	}, []);

	useEffect(() => {
		if (!menu) return;
		const close = () => setMenu(null);
		const onDown = (e: Event) => {
			if (!(e.target as Element).closest?.("[data-context-menu]")) close();
		};
		const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
		document.addEventListener("pointerdown", onDown);
		document.addEventListener("keydown", esc);
		window.addEventListener("blur", close);
		window.addEventListener("resize", close);
		window.addEventListener("scroll", close, true);
		return () => {
			document.removeEventListener("pointerdown", onDown);
			document.removeEventListener("keydown", esc);
			window.removeEventListener("blur", close);
			window.removeEventListener("resize", close);
			window.removeEventListener("scroll", close, true);
		};
	}, [menu]);

	if (!menu) return null;
	const height = menu.items.length * ROW + 8;
	return (
		<div
			role="menu"
			data-context-menu
			// Keep focus and the text selection where they are, so Cut/Copy/Paste act on them.
			onMouseDown={(e) => e.preventDefault()}
			style={{
				position: "fixed",
				width: WIDTH,
				left: Math.max(8, Math.min(menu.x, window.innerWidth - WIDTH - 8)),
				top: Math.max(8, Math.min(menu.y, window.innerHeight - height - 8)),
			}}
			className="z-[100] rounded-2xl border border-line bg-raised p-1 shadow-lg"
		>
			{menu.items.map((item) => (
				<div key={item.label}>
					{item.divider ? (
						<div className="mx-2 my-1 border-t border-line2" />
					) : null}
					<button
						type="button"
						role="menuitem"
						onClick={() => {
							setMenu(null);
							item.run();
						}}
						className="block w-full truncate rounded-2xl px-3 py-1.5 text-left text-sm text-ink hover:bg-hover"
					>
						{item.label}
					</button>
				</div>
			))}
		</div>
	);
}
