import { createExtension } from "@blocknote/core";
import { Plugin, TextSelection } from "prosemirror-state";
import { getPrefs } from "../preferences";
import { typingRule } from "./typing";

/** Smart punctuation and auto-pair, read from the preferences at every keystroke (no editor rebuild). */
export const typingExtension = createExtension({
	key: "seijakuTyping",
	prosemirrorPlugins: [
		new Plugin({
			props: {
				handleTextInput(view, from, to, text) {
					const p = getPrefs();
					if (!p.smartPunctuation && !p.autoPair) return false;
					const { state } = view;
					const $from = state.doc.resolve(from);
					// Code stays exactly as typed.
					if ($from.parent.type.spec.code || !$from.parent.inlineContent)
						return false;
					if (
						state.doc
							.resolve(from)
							.marks()
							.some((m) => m.type.name === "code")
					)
						return false;
					const start = $from.start();
					const before = state.doc.textBetween(start, from, "\n", "￼");
					const after = state.doc.textBetween(to, $from.end(), "\n", "￼");
					const edit = typingRule(
						{ smart: p.smartPunctuation, pair: p.autoPair },
						before,
						after,
						text,
					);
					if (!edit) return false;
					if (edit.cursorBack < 0) {
						// Step over the closing character that is already there.
						view.dispatch(
							state.tr.setSelection(TextSelection.create(state.doc, to + 1)),
						);
						return true;
					}
					const tr = state.tr.insertText(
						edit.insert,
						from - edit.deleteBefore,
						to,
					);
					const end = from - edit.deleteBefore + edit.insert.length;
					tr.setSelection(TextSelection.create(tr.doc, end - edit.cursorBack));
					view.dispatch(tr);
					return true;
				},
			},
		}),
	],
});
