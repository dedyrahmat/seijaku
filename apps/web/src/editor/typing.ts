/**
 * The two "Writing" switches in Settings, as pure text rules so they can be tested without an
 * editor: smart punctuation (curly quotes, dashes, ellipsis) and auto-pairing brackets and quotes.
 */

export interface TypingOptions {
	smart: boolean;
	pair: boolean;
}

export interface TypingEdit {
	/** Characters to remove before the cursor. */
	deleteBefore: number;
	insert: string;
	/** Characters to move the cursor back after inserting (to sit between a pair). */
	cursorBack: number;
}

const OPEN_AFTER = /(^|[\s([{—–-])$/;
const WORD = /[\p{L}\p{N}]$/u;
const CLOSERS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const CLOSING = new Set([")", "]", "}", '"', "”", "’"]);

/** `before` and `after` are the text on either side of the cursor within the same text block. */
export function typingRule(
	o: TypingOptions,
	before: string,
	after: string,
	typed: string,
): TypingEdit | null {
	if (typed.length !== 1) return null;

	// Typing a closing character right before the same one just steps over it.
	if (o.pair && CLOSING.has(typed) && after.startsWith(typed))
		return { deleteBefore: 0, insert: "", cursorBack: -1 };

	if (o.smart) {
		if (typed === '"') {
			const open = OPEN_AFTER.test(before);
			if (o.pair && open && !WORD.test(after.slice(0, 1)))
				return { deleteBefore: 0, insert: "“”", cursorBack: 1 };
			return {
				deleteBefore: 0,
				insert: open ? "“" : "”",
				cursorBack: 0,
			};
		}
		if (typed === "'") {
			const open = !WORD.test(before) && !/[.,!?)”]$/.test(before);
			return {
				deleteBefore: 0,
				insert: open ? "‘" : "’",
				cursorBack: 0,
			};
		}
		if (typed === "." && before.endsWith(".."))
			return { deleteBefore: 2, insert: "…", cursorBack: 0 };
		if (typed === "-" && before.endsWith("–"))
			return { deleteBefore: 1, insert: "—", cursorBack: 0 };
		if (typed === "-" && before.endsWith("-") && !before.endsWith("--"))
			return { deleteBefore: 1, insert: "–", cursorBack: 0 };
	}

	if (o.pair) {
		const next = after.slice(0, 1);
		const roomy = next === "" || /\s/.test(next) || CLOSING.has(next);
		if (typed in CLOSERS && roomy)
			return {
				deleteBefore: 0,
				insert: typed + (CLOSERS[typed] ?? ""),
				cursorBack: 1,
			};
		if (typed === '"' && !o.smart && roomy && !WORD.test(before))
			return { deleteBefore: 0, insert: '""', cursorBack: 1 };
	}
	return null;
}
