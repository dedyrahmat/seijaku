import { codeBlockOptions } from "@blocknote/code-block";
import {
	BlockNoteSchema,
	createBlockSpec,
	createCodeBlockSpec,
	defaultBlockSpecs,
} from "@blocknote/core";
import katex from "katex";
import { fetchPreview, webAddress } from "./preview";

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

/**
 * A link shown as a card: site, title and a line of description. Insert it empty and paste a
 * link; the server is asked once and the answer is stored in the block, so the card reads the
 * same offline and for everyone the note syncs to.
 */
const createLinkPreviewBlock = createBlockSpec(
	{
		type: "linkPreview",
		propSchema: {
			url: { default: "" },
			title: { default: "" },
			description: { default: "" },
			site: { default: "" },
		},
		content: "none",
	},
	{
		render: (block, editor) => {
			const dom = document.createElement("div");
			dom.className = "seijaku-linkcard";
			dom.contentEditable = "false";

			if (!block.props.url) {
				const input = document.createElement("input");
				input.type = "url";
				input.className = "seijaku-linkcard__input";
				input.placeholder = "Paste a link and press Enter";
				input.setAttribute("aria-label", "Link to preview");
				const note = document.createElement("span");
				note.className = "seijaku-linkcard__note";
				note.textContent =
					"Your server fetches the page once to read its title.";
				input.addEventListener("keydown", async (e) => {
					e.stopPropagation(); // typing here is not editing the note
					if (e.key !== "Enter") return;
					e.preventDefault();
					const url = webAddress(input.value);
					if (!url) {
						note.textContent = "That does not look like a web address.";
						return;
					}
					input.disabled = true;
					const found = await fetchPreview(url);
					editor.updateBlock(block, {
						props: { url, ...(found ?? {}) },
					});
				});
				dom.append(input, note);
				return { dom };
			}

			const card = document.createElement("a");
			card.href = block.props.url;
			card.target = "_blank";
			card.rel = "noopener noreferrer";
			card.className = "seijaku-linkcard__card";
			const site = document.createElement("span");
			site.className = "seijaku-linkcard__site";
			site.textContent = block.props.site || new URL(block.props.url).hostname;
			const title = document.createElement("span");
			title.className = "seijaku-linkcard__title";
			title.textContent = block.props.title || block.props.url;
			card.append(site, title);
			if (block.props.description) {
				const text = document.createElement("span");
				text.className = "seijaku-linkcard__text";
				text.textContent = block.props.description;
				card.append(text);
			}
			dom.append(card);
			return { dom };
		},
	},
);

export const schema = BlockNoteSchema.create({
	blockSpecs: {
		...defaultBlockSpecs,
		codeBlock: createCodeBlockSpec(codeBlockOptions),
		callout: createCalloutBlock(),
		math: createMathBlock(),
		linkPreview: createLinkPreviewBlock(),
	},
});

export type SeijakuSchema = typeof schema;
