import { rangeBetween } from "@seijaku/sync";
import { useCallback, useRef, useState } from "react";

/**
 * "Select pages" mode for the sidebar and the Trash. Ticking works by checkbox on any device, and
 * by Ctrl/Cmd-click and Shift-click (a range, in the order rows are on screen) with a keyboard.
 */
export function useSelection() {
	const [on, setOn] = useState(false);
	const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
	const anchor = useRef<string | null>(null);

	/** Turns the mode on, optionally with one row already ticked. */
	const start = useCallback((id?: string) => {
		setOn(true);
		setIds(new Set(id ? [id] : []));
		anchor.current = id ?? null;
	}, []);

	const stop = useCallback(() => {
		setOn(false);
		setIds(new Set());
		anchor.current = null;
	}, []);

	/** Ticks or unticks `id`; with Shift, ticks everything from the last tick to `id`. */
	const pick = useCallback(
		(id: string, order: string[], opts: { range?: boolean } = {}) => {
			const from = anchor.current;
			setIds((prev) => {
				const next = new Set(prev);
				if (opts.range && from) {
					for (const x of rangeBetween(order, from, id)) next.add(x);
				} else if (next.has(id)) next.delete(id);
				else next.add(id);
				return next;
			});
			if (!opts.range) anchor.current = id;
		},
		[],
	);

	const setAll = useCallback((all: string[]) => setIds(new Set(all)), []);

	return { on, ids, start, stop, pick, setAll };
}
