import * as Y from "yjs";

/** Plain text of a note's editor content, blocks separated by newlines. */
export function fragmentText(node: Y.XmlFragment | Y.XmlElement): string {
	const parts: string[] = [];
	for (const child of node.toArray()) {
		if (child instanceof Y.XmlText) {
			parts.push(
				child
					.toDelta()
					.map((d: { insert?: unknown }) =>
						typeof d.insert === "string" ? d.insert : "",
					)
					.join(""),
			);
		} else if (child instanceof Y.XmlElement) {
			parts.push(fragmentText(child));
		}
	}
	return parts.join("\n");
}

const segmenter =
	typeof Intl !== "undefined" && "Segmenter" in Intl
		? new Intl.Segmenter(undefined, { granularity: "word" })
		: null;

/** Word count that also works for Japanese and other text written without spaces. */
export function countWords(text: string): number {
	if (!segmenter) return text.match(/\S+/g)?.length ?? 0;
	let n = 0;
	for (const s of segmenter.segment(text)) if (s.isWordLike) n += 1;
	return n;
}

/** The inline element a `[[link]]` is stored as in a note's content; its `noteId` attribute names the target page. */
export const PAGE_LINK = "pageLink";

export interface FoundLink {
	/** Id of the page the link points at. */
	target: string;
	/** The line the link sits in, shortened around it, with links written as their page's title. */
	text: string;
}

const AROUND = 60;

/** Every page link in a note, each with the words around it. `titleOf` names a linked page (empty when it is gone). */
export function fragmentLinks(
	node: Y.XmlFragment | Y.XmlElement,
	titleOf: (id: string) => string,
): FoundLink[] {
	const out: FoundLink[] = [];
	const children = node.toArray();
	const isLink = (c: unknown): c is Y.XmlElement =>
		c instanceof Y.XmlElement && c.nodeName === PAGE_LINK;
	if (children.some((c) => c instanceof Y.XmlText || isLink(c))) {
		// A line of text: write it out, remembering where each link falls.
		let text = "";
		const at: { target: string; from: number; to: number }[] = [];
		for (const c of children) {
			if (c instanceof Y.XmlText)
				text += c
					.toDelta()
					.map((d: { insert?: unknown }) =>
						typeof d.insert === "string" ? d.insert : "",
					)
					.join("");
			else if (isLink(c)) {
				const target = String(c.getAttribute("noteId") ?? "");
				const title = titleOf(target) || target;
				at.push({ target, from: text.length, to: text.length + title.length });
				text += title;
			} else if (c instanceof Y.XmlElement) text += fragmentText(c);
		}
		for (const { target, from, to } of at) {
			const start = Math.max(0, from - AROUND);
			const end = Math.min(text.length, to + AROUND);
			out.push({
				target,
				text:
					(start > 0 ? "…" : "") +
					text.slice(start, end).replace(/\s+/g, " ") +
					(end < text.length ? "…" : ""),
			});
		}
		return out;
	}
	for (const c of children)
		if (c instanceof Y.XmlElement) out.push(...fragmentLinks(c, titleOf));
	return out;
}
