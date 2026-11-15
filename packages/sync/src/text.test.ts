import { expect, test } from "bun:test";
import * as Y from "yjs";
import { countWords, fragmentText } from "./text";

test("counts words in plain and unspaced text", () => {
	expect(countWords("")).toBe(0);
	expect(countWords("a signal is a sum of waves")).toBe(7);
	expect(countWords("静寂は、騒がしさの反対。")).toBeGreaterThan(1);
});

test("reads text out of nested blocks", () => {
	const doc = new Y.Doc();
	const frag = doc.getXmlFragment("f");
	const block = new Y.XmlElement("paragraph");
	const text = new Y.XmlText("hello world");
	block.insert(0, [text]);
	frag.insert(0, [block]);
	expect(fragmentText(frag)).toBe("hello world");
});
