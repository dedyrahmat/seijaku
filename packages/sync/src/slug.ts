/**
 * Readable page URLs: `Getting-Started-40a07db1786d80a68e2a`.
 * The title is for people; the trailing id is what the app looks up, so renaming a page
 * never breaks an old link.
 */

const MAX_TITLE_CHARS = 60;
const DAILY_ID = /daily-\d{4}-\d{2}-\d{2}$/;

/** Letters and numbers from any script survive (so Japanese titles stay readable). */
export function titleSlug(title: string): string {
	const slug = title
		.normalize("NFKC")
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, MAX_TITLE_CHARS)
		.replace(/-+$/g, "");
	return slug || "Untitled";
}

export function pageSlug(title: string, id: string): string {
	return `${titleSlug(title)}-${id}`;
}

/** The note id at the end of a page slug. A bare id is accepted too. */
export function parsePageSlug(slug: string): string {
	const daily = DAILY_ID.exec(slug);
	if (daily) return daily[0];
	return slug.slice(slug.lastIndexOf("-") + 1);
}
