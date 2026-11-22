import { expect, test } from "bun:test";
import { typingRule } from "./typing";

const smart = { smart: true, pair: false };
const both = { smart: true, pair: true };
const pair = { smart: false, pair: true };

test("quotes curl by what comes before them", () => {
	expect(typingRule(smart, "", "", '"')?.insert).toBe("“");
	expect(typingRule(smart, "say ", "", '"')?.insert).toBe("“");
	expect(typingRule(smart, "done", "", '"')?.insert).toBe("”");
	expect(typingRule(smart, "it", "", "'")?.insert).toBe("’");
	expect(typingRule(smart, "a ", "", "'")?.insert).toBe("‘");
});

test("dots and hyphens become an ellipsis and dashes", () => {
	expect(typingRule(smart, "wait..", "", ".")).toEqual({
		deleteBefore: 2,
		insert: "…",
		cursorBack: 0,
	});
	expect(typingRule(smart, "a-", "", "-")?.insert).toBe("–");
	expect(typingRule(smart, "a–", "", "-")?.insert).toBe("—");
	expect(typingRule(smart, "a ", "", "-")).toBeNull();
});

test("nothing changes when both switches are off", () => {
	const off = { smart: false, pair: false };
	for (const c of ['"', "'", ".", "-", "(", "["])
		expect(typingRule(off, "a..", "", c)).toBeNull();
});

test("brackets pair, and a closer steps over its twin", () => {
	expect(typingRule(pair, "", "", "(")).toEqual({
		deleteBefore: 0,
		insert: "()",
		cursorBack: 1,
	});
	expect(typingRule(pair, "(a", ")", ")")?.cursorBack).toBe(-1);
	expect(typingRule(pair, "", "word", "(")).toBeNull();
});

test("curly quotes pair when both are on", () => {
	expect(typingRule(both, "", "", '"')?.insert).toBe("“”");
	expect(typingRule(pair, "", "", '"')?.insert).toBe('""');
	expect(typingRule(pair, "it", "", '"')).toBeNull();
});
