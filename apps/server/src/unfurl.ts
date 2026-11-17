/**
 * Link previews: fetches a page on the server's behalf and returns the few facts a card needs.
 * Runs on both runtimes. The server learns which link was asked about (the one place it does),
 * so the app asks once, when a link is inserted, and keeps the answer in the note.
 */

export interface Preview {
	url: string;
	title: string;
	description: string;
	site: string;
}

export class UnfurlError extends Error {}

const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;

/** True for names and addresses that point inside a network: never fetched. */
export function isPrivateHost(host: string): boolean {
	const h = host.toLowerCase().replace(/^\[|\]$/g, "");
	if (h === "localhost" || h.endsWith(".localhost")) return true;
	const isV6 = h.includes(":");
	// A bare name ("intranet") or a .local/.internal one only resolves inside a network.
	if (
		!isV6 &&
		(h.endsWith(".local") || h.endsWith(".internal") || !h.includes("."))
	)
		return true;
	const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
	if (v4) {
		const [a, b] = [Number(v4[1]), Number(v4[2])];
		return (
			a === 0 ||
			a === 10 ||
			a === 127 ||
			(a === 100 && b >= 64 && b <= 127) ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			a >= 224
		);
	}
	if (h.includes(":")) {
		const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
		if (mapped) return isPrivateHost(mapped[1] as string);
		return (
			h === "::" ||
			h === "::1" ||
			/^f[cd]/.test(h) || // unique local
			/^fe[89ab]/.test(h) // link local
		);
	}
	return false;
}

/** The page address, or an error: http(s) only, no credentials, no inner network. */
export function checkUrl(raw: string): URL {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new UnfurlError("That is not a link.");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:")
		throw new UnfurlError("Only web links can have a preview.");
	if (url.username || url.password)
		throw new UnfurlError("Links with a password in them are not previewed.");
	if (isPrivateHost(url.hostname))
		throw new UnfurlError("That address is not on the public internet.");
	return url;
}

const ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
};

function decode(text: string): string {
	return text
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) =>
			String.fromCodePoint(parseInt(n, 16)),
		)
		.replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
		.replace(/\s+/g, " ")
		.trim();
}

/** Title, description and site name from the head of an HTML page. */
export function readMeta(html: string, url: URL): Preview {
	const head = html.slice(0, html.search(/<\/head>/i) + 1 || MAX_BYTES);
	const meta = new Map<string, string>();
	for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
		const key = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1];
		const value = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1];
		if (key && value !== undefined && !meta.has(key.toLowerCase()))
			meta.set(key.toLowerCase(), decode(value));
	}
	const titleTag = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
	const title =
		meta.get("og:title") ??
		meta.get("twitter:title") ??
		(titleTag ? decode(titleTag) : "");
	const description =
		meta.get("og:description") ??
		meta.get("twitter:description") ??
		meta.get("description") ??
		"";
	return {
		url: url.href,
		title: title.slice(0, 200),
		description: description.slice(0, 300),
		site: (
			meta.get("og:site_name") ?? url.hostname.replace(/^www\./, "")
		).slice(0, 80),
	};
}

/** Reads at most `limit` bytes of a response body as text. */
async function readText(res: Response, limit: number): Promise<string> {
	const reader = res.body?.getReader();
	if (!reader) return "";
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (size < limit) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		size += value.byteLength;
	}
	await reader.cancel().catch(() => undefined);
	const all = new Uint8Array(Math.min(size, limit));
	let at = 0;
	for (const c of chunks) {
		const part = c.subarray(0, all.length - at);
		all.set(part, at);
		at += part.length;
	}
	return new TextDecoder().decode(all);
}

export interface UnfurlOptions {
	/**
	 * Extra check on a name before it is fetched (self-host resolves it and refuses inner
	 * addresses; on Cloudflare the platform already refuses them). Return false to refuse.
	 */
	allowHost?: (host: string) => Promise<boolean>;
	fetcher?: typeof fetch;
}

/**
 * shortcut: a hostile DNS server can answer differently at fetch time than at check time
 * (rebinding); upgrade by pinning the checked address once Bun can connect to one.
 */
export async function unfurl(
	raw: string,
	{ allowHost, fetcher = fetch }: UnfurlOptions = {},
): Promise<Preview> {
	let url = checkUrl(raw);
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		if (allowHost && !(await allowHost(url.hostname)))
			throw new UnfurlError("That address is not on the public internet.");
		let res: Response;
		try {
			res = await fetcher(url, {
				redirect: "manual",
				signal: AbortSignal.timeout(5000),
				headers: {
					Accept: "text/html",
					"User-Agent": "Mozilla/5.0 (compatible; SeijakuLinkPreview/1.0)",
				},
			});
		} catch {
			throw new UnfurlError("Could not reach that page.");
		}
		if (res.status >= 300 && res.status < 400) {
			const next = res.headers.get("location");
			if (!next) throw new UnfurlError("Could not read that page.");
			url = checkUrl(new URL(next, url).href);
			continue;
		}
		if (!res.ok) throw new UnfurlError("That page did not load.");
		if (!(res.headers.get("content-type") ?? "").includes("text/html"))
			return {
				url: url.href,
				title: "",
				description: "",
				site: url.hostname.replace(/^www\./, ""),
			};
		return readMeta(await readText(res, MAX_BYTES), url);
	}
	throw new UnfurlError("That link redirects too many times.");
}
