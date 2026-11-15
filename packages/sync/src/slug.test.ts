import { describe, expect, test } from "bun:test";
import { pageSlug, parsePageSlug, titleSlug } from "./slug";

describe("page slugs", () => {
	test("joins a readable title and the id", () => {
		expect(pageSlug("Getting Started", "40a07db1786d80a68e2a")).toBe(
			"Getting-Started-40a07db1786d80a68e2a",
		);
	});

	test("round-trips the id", () => {
		const id = "40a07db1786d80a68e2a";
		for (const title of [
			"Getting Started",
			"",
			"a-b-c",
			"  --  ",
			"Fourier, slowly!",
		]) {
			expect(parsePageSlug(pageSlug(title, id))).toBe(id);
		}
	});

	test("daily note ids contain dashes and still round-trip", () => {
		const id = "daily-2026-11-15";
		expect(pageSlug("Sunday", id)).toBe("Sunday-daily-2026-11-15");
		expect(parsePageSlug(pageSlug("Sunday", id))).toBe(id);
		expect(parsePageSlug(id)).toBe(id);
	});

	test("a bare id is accepted", () => {
		expect(parsePageSlug("40a07db1786d80a68e2a")).toBe("40a07db1786d80a68e2a");
	});

	test("empty or symbol-only titles become Untitled", () => {
		expect(titleSlug("")).toBe("Untitled");
		expect(titleSlug("?!")).toBe("Untitled");
	});

	test("keeps non-Latin letters and drops punctuation", () => {
		expect(titleSlug("静寂 — notes")).toBe("静寂-notes");
		expect(titleSlug("Café au lait")).toBe("Café-au-lait");
	});

	test("long titles are cut without a trailing dash", () => {
		const slug = titleSlug(`${"word ".repeat(30)}`);
		expect(slug.length).toBeLessThanOrEqual(60);
		expect(slug.endsWith("-")).toBe(false);
	});
});
