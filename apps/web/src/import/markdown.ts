import {
	basename,
	dirname,
	type Entries,
	type FileRefs,
	resolvePath,
} from "./model";

export const decoder = new TextDecoder("utf-8");
export const text = (bytes: Uint8Array): string => decoder.decode(bytes);

/** Runs `fn` on the prose of a Markdown text, leaving fenced and inline code untouched. */
export function outsideCode(
	src: string,
	fn: (prose: string) => string,
): string {
	return src
		.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g)
		.map((part, i) => (i % 2 === 1 ? part : fn(part)))
		.join("");
}

const REMOTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

/** Finds a file an export refers to: relative to the note, from the root, or by name anywhere. */
export function lookupFile(
	entries: Entries,
	byName: Map<string, string>,
	noteDir: string,
	ref: string,
): string | null {
	let target = ref.trim().replace(/^<|>$/g, "");
	try {
		target = decodeURIComponent(target);
	} catch {
		// Not percent-encoded after all.
	}
	target = target.split("#")[0]?.split("?")[0] ?? target;
	for (const candidate of [
		resolvePath(noteDir, target),
		resolvePath("", target),
	])
		if (entries.has(candidate)) return candidate;
	return byName.get(basename(target).toLowerCase()) ?? null;
}

/** Every file by lower-cased name, for exports that refer to files without a path. */
export function nameIndex(
	entries: Entries,
	keep: (path: string) => boolean,
): Map<string, string> {
	const map = new Map<string, string>();
	for (const path of entries.keys())
		if (keep(path) && !map.has(basename(path).toLowerCase()))
			map.set(basename(path).toLowerCase(), path);
	return map;
}

/**
 * Points every Markdown image at a file reference the writer understands. An image the
 * export does not contain stays as it is and is reported.
 */
export function rewriteImages(
	src: string,
	entries: Entries,
	byName: Map<string, string>,
	notePath: string,
	refs: FileRefs,
	warnings: string[],
): string {
	return outsideCode(src, (prose) =>
		prose.replace(
			/!\[([^\]]*)\]\(([^)\n]+)\)/g,
			(whole, alt: string, raw: string) => {
				const target = raw.trim().split(/\s+"/)[0] as string;
				if (REMOTE.test(target)) return whole;
				const found = lookupFile(entries, byName, dirname(notePath), target);
				const ref = found ? refs.ref(found) : null;
				if (!ref) {
					warnings.push(`Image not found: ${basename(target)}`);
					return `*(image missing: ${basename(target)})*`;
				}
				return `![${alt}](${ref})`;
			},
		),
	);
}
