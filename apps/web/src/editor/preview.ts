import { apiUrl } from "../workspace/syncUrl";

export interface LinkPreview {
	title: string;
	description: string;
	site: string;
}

/**
 * Asks the server what a link is. The server sees the address (it fetches the page), so this
 * runs once when a link is inserted and the answer is kept in the note, never re-asked.
 */
export async function fetchPreview(url: string): Promise<LinkPreview | null> {
	try {
		const res = await fetch(
			apiUrl(`/api/unfurl?url=${encodeURIComponent(url)}`),
			{
				credentials: "include",
			},
		);
		if (!res.ok) return null;
		const { title, description, site } = (await res.json()) as LinkPreview;
		return { title, description, site };
	} catch {
		return null;
	}
}

/** "example.com/a" or "https://example.com/a" to a full web address, or null. */
export function webAddress(input: string): string | null {
	const text = input.trim();
	if (!text) return null;
	try {
		const url = new URL(
			/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`,
		);
		return url.protocol === "http:" || url.protocol === "https:"
			? url.href
			: null;
	} catch {
		return null;
	}
}
