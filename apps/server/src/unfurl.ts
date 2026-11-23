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

/** True for IPv4 addresses that are not on the public internet. */
function privateV4(a: number, b: number, c: number): boolean {
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 0 && (c === 0 || c === 2)) ||
		(a === 192 && b === 168) ||
		(a === 198 && (b === 18 || b === 19)) ||
		(a === 198 && b === 51 && c === 100) ||
		(a === 203 && b === 0 && c === 113) ||
		a >= 224
	);
}

/** Eight 16-bit groups of an IPv6 address, or null when it is not one. Takes `::` and a dotted tail. */
function parseV6(host: string): number[] | null {
	let text = host.split("%")[0] as string;
	const dotted = text.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
	if (dotted) {
		const [a = 0, b = 0, c = 0, d = 0] = dotted.slice(2).map(Number);
		if ([a, b, c, d].some((n) => n > 255)) return null;
		text = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
	}
	const halves = text.split("::");
	if (halves.length > 2) return null;
	const side = (s: string) => (s === "" ? [] : s.split(":"));
	const head = side(halves[0] as string);
	const tail = halves.length === 2 ? side(halves[1] as string) : [];
	const missing = 8 - head.length - tail.length;
	if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
	const groups = [
		...head,
		...Array(halves.length === 2 ? missing : 0).fill("0"),
		...tail,
	];
	const nums = groups.map((g) =>
		/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN,
	);
	return nums.length === 8 && nums.every((n) => !Number.isNaN(n)) ? nums : null;
}

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
	if (v4) return privateV4(Number(v4[1]), Number(v4[2]), Number(v4[3]));
	if (isV6) {
		const g = parseV6(h);
		if (!g) return true; // not an address we understand: do not fetch it
		const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;
		const embedded = (hi: number, lo: number) =>
			privateV4(hi >> 8, hi & 255, lo >> 8);
		// Addresses that carry an IPv4 one (mapped, compatible, NAT64, 6to4): judge that one.
		if (
			g0 === 0 &&
			g1 === 0 &&
			g2 === 0 &&
			g3 === 0 &&
			g4 === 0 &&
			(g5 === 0xffff || g5 === 0)
		)
			return g5 === 0 && g6 === 0 && g7 <= 1 ? true : embedded(g6, g7);
		if (
			g0 === 0x64 &&
			g1 === 0xff9b &&
			g2 === 0 &&
			g3 === 0 &&
			g4 === 0 &&
			g5 === 0
		)
			return embedded(g6, g7);
		if (g0 === 0x2002) return embedded(g1, g2);
		return (
			(g0 & 0xfe00) === 0xfc00 || // unique local
			(g0 & 0xffc0) === 0xfe80 || // link local
			(g0 & 0xffc0) === 0xfec0 || // site local
			(g0 & 0xff00) === 0xff00 || // multicast
			(g0 === 0x2001 && g1 === 0x0db8) // documentation
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
	 * Self-host resolves a name once, refuses inner addresses (null), and returns the address
	 * it checked; the fetch then connects to exactly that address, so a hostile DNS server
	 * cannot answer differently the second time. On Cloudflare the platform already refuses
	 * inner addresses, so nothing is passed.
	 */
	resolveHost?: (host: string) => Promise<string | null>;
	fetcher?: typeof fetch;
}

export async function unfurl(
	raw: string,
	{ resolveHost, fetcher = fetch }: UnfurlOptions = {},
): Promise<Preview> {
	let url = checkUrl(raw);
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		const address = resolveHost ? await resolveHost(url.hostname) : undefined;
		if (address === null)
			throw new UnfurlError("That address is not on the public internet.");
		// Connect to the checked address; the name still goes in Host and the TLS server name.
		const target = new URL(url);
		if (address)
			target.hostname = address.includes(":") ? `[${address}]` : address;
		let res: Response;
		try {
			res = await fetcher(target, {
				redirect: "manual",
				signal: AbortSignal.timeout(5000),
				headers: {
					Accept: "text/html",
					"User-Agent": "Mozilla/5.0 (compatible; SeijakuLinkPreview/1.0)",
					...(address ? { Host: url.host } : {}),
				},
				...(address ? { tls: { serverName: url.hostname } } : {}),
			} as RequestInit);
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
