import { codeBlockOptions } from "@blocknote/code-block";
import {
	BlockNoteSchema,
	createBlockSpec,
	createCodeBlockSpec,
	defaultBlockSpecs,
} from "@blocknote/core";
import katex from "katex";

export const CALLOUT_TONES = ["note", "tip", "warning"] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];
const TONE_MARK: Record<CalloutTone, string> = {
	note: "ℹ",
	tip: "✦",
	warning: "!",
};

/** A highlighted aside. Click the mark to cycle its tone. */
const createCalloutBlock = createBlockSpec(
	{
		type: "callout",
		propSchema: {
			tone: { default: "note", values: CALLOUT_TONES },
		},
		content: "inline",
	},
	{
		render: (block, editor) => {
			const dom = document.createElement("div");
			dom.className = "seijaku-callout";
			dom.dataset.tone = block.props.tone;

			const mark = document.createElement("button");
			mark.type = "button";
			mark.contentEditable = "false";
			mark.className = "seijaku-callout__mark";
			mark.textContent = TONE_MARK[block.props.tone];
			mark.title = "Change callout style";
			mark.setAttribute(
				"aria-label",
				`Callout: ${block.props.tone}. Change style`,
			);
			mark.addEventListener("click", () => {
				const i = CALLOUT_TONES.indexOf(block.props.tone);
				const next = CALLOUT_TONES[(i + 1) % CALLOUT_TONES.length];
				editor.updateBlock(block, { props: { tone: next } });
			});

			const contentDOM = document.createElement("div");
			contentDOM.className = "seijaku-callout__body";
			dom.append(mark, contentDOM);
			return { dom, contentDOM };
		},
	},
);

/**
 * Math: the LaTeX source is plain, editable text in the document; a live KaTeX
 * rendering sits above it. (BlockNote 0.57 declares a code-block `createPreview`
 * option but never calls it, so this is a block of our own.)
 */
const createMathBlock = createBlockSpec(
	{ type: "math", propSchema: {}, content: "plain" },
	{
		render: () => {
			const dom = document.createElement("div");
			dom.className = "seijaku-mathblock";

			const preview = document.createElement("div");
			preview.className = "seijaku-math";
			preview.contentEditable = "false";

			const contentDOM = document.createElement("div");
			contentDOM.className = "seijaku-mathblock__source";
			contentDOM.spellcheck = false;
			dom.append(preview, contentDOM);

			const draw = () => {
				const source = contentDOM.textContent ?? "";
				preview.classList.remove("seijaku-math--empty", "seijaku-math--error");
				if (!source.trim()) {
					preview.textContent = "Write an equation below";
					preview.classList.add("seijaku-math--empty");
					return;
				}
				try {
					katex.render(source, preview, {
						displayMode: true,
						throwOnError: true,
					});
				} catch (err) {
					preview.textContent =
						err instanceof Error
							? err.message.replace(/^KaTeX parse error: /, "")
							: "Invalid equation";
					preview.classList.add("seijaku-math--error");
				}
			};

			const observer = new MutationObserver(draw);
			observer.observe(contentDOM, {
				childList: true,
				characterData: true,
				subtree: true,
			});
			draw();
			return {
				dom,
				contentDOM,
				// KaTeX rewrites the preview on every keystroke. Without this, ProseMirror
				// treats those DOM changes as edits, re-renders the block, and loops forever.
				ignoreMutation: (mutation) =>
					mutation.type !== "selection" && preview.contains(mutation.target),
				destroy: () => observer.disconnect(),
			};
		},
	},
);

export const schema = BlockNoteSchema.create({
	blockSpecs: {
		...defaultBlockSpecs,
		codeBlock: createCodeBlockSpec(codeBlockOptions),
		callout: createCalloutBlock(),
		math: createMathBlock(),
	},
});

export type SeijakuSchema = typeof schema;
