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
