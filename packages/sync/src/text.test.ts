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

test("finds page links with the words around them", async () => {
	const { fragmentLinks } = await import("./text");
	const doc = new Y.Doc();
	const frag = doc.getXmlFragment("f");
	const group = new Y.XmlElement("blockGroup");
	const container = new Y.XmlElement("blockContainer");
	const para = new Y.XmlElement("paragraph");
	const link = new Y.XmlElement("pageLink");
	link.setAttribute("noteId", "abc");
	para.insert(0, [new Y.XmlText("see "), link, new Y.XmlText(" later")]);
	container.insert(0, [para]);
	group.insert(0, [container]);
	frag.insert(0, [group]);
	expect(fragmentLinks(frag, (id) => (id === "abc" ? "Packing" : ""))).toEqual([
		{ target: "abc", text: "see Packing later" },
	]);
	// A link to a page that no longer exists still reports its target.
	expect(fragmentLinks(frag, () => "")[0]?.target).toBe("abc");
});
