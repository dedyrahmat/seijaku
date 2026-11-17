import { expect, test } from "bun:test";
import { checkUrl, isPrivateHost, readMeta, unfurl } from "./unfurl";

test("inner-network addresses are refused, public ones pass", () => {
	for (const host of [
		"localhost",
		"app.localhost",
		"printer.local",
		"intranet",
		"127.0.0.1",
		"10.1.2.3",
		"172.16.0.1",
		"192.168.1.1",
		"169.254.169.254",
		"100.64.0.1",
		"0.0.0.0",
		"[::1]",
		"[fd12::1]",
		"[::ffff:127.0.0.1]",
	])
		expect(isPrivateHost(host)).toBe(true);
	for (const host of ["example.com", "8.8.8.8", "172.32.0.1", "news.bbc.co.uk"])
		expect(isPrivateHost(host)).toBe(false);
});

test("only plain public web links are accepted", () => {
	expect(() => checkUrl("ftp://example.com")).toThrow();
	expect(() => checkUrl("file:///etc/passwd")).toThrow();
	expect(() => checkUrl("https://user:pw@example.com")).toThrow();
	expect(() => checkUrl("http://169.254.169.254/latest")).toThrow();
	expect(() => checkUrl("nonsense")).toThrow();
	expect(checkUrl("https://example.com/a").hostname).toBe("example.com");
});

test("title, description and site come from the page's head", () => {
	const html = `<html><head><title>Plain &amp; simple</title>
		<meta property="og:title" content="Open &quot;Graph&quot; title">
		<meta name="description" content="A page.">
		<meta property='og:site_name' content='Example'></head><body><meta name="description" content="ignored"></body></html>`;
	expect(readMeta(html, new URL("https://www.example.com/x"))).toEqual({
		url: "https://www.example.com/x",
		title: 'Open "Graph" title',
		description: "A page.",
		site: "Example",
	});
	expect(
		readMeta("<title>Only</title>", new URL("https://www.example.com/")).site,
	).toBe("example.com");
});

function page(html: string, init: ResponseInit = {}) {
	return new Response(html, {
		headers: { "content-type": "text/html" },
		...init,
	});
}

test("a redirect to the inner network is refused, a public one is followed", async () => {
	const fetcher = (async (input: URL | string) => {
		const u = String(input);
		if (u === "https://short.example/a")
			return new Response(null, {
				status: 302,
				headers: { location: "https://real.example/b" },
			});
		if (u === "https://evil.example/a")
			return new Response(null, {
				status: 302,
				headers: { location: "http://127.0.0.1:8791/api/health" },
			});
		return page("<title>Real</title>");
	}) as typeof fetch;
	expect((await unfurl("https://short.example/a", { fetcher })).title).toBe(
		"Real",
	);
	await expect(unfurl("https://evil.example/a", { fetcher })).rejects.toThrow(
		"public internet",
	);
});

test("the resolver can refuse a name that points inside", async () => {
	const fetcher = (async () =>
		page("<title>x</title>")) as unknown as typeof fetch;
	await expect(
		unfurl("https://sneaky.example/", {
			fetcher,
			allowHost: async () => false,
		}),
	).rejects.toThrow("public internet");
});

test("a page that is not HTML gets a bare card", async () => {
	const fetcher = (async () =>
		new Response("%PDF", {
			headers: { "content-type": "application/pdf" },
		})) as unknown as typeof fetch;
	expect(await unfurl("https://example.com/a.pdf", { fetcher })).toEqual({
		url: "https://example.com/a.pdf",
		title: "",
		description: "",
		site: "example.com",
	});
});
