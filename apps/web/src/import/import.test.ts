import { expect, test } from "bun:test";
import { md5 } from "@noble/hashes/legacy.js";
import { toBase64 } from "@seijaku/sync";
import { strToU8, zipSync } from "fflate";
import { readEntries } from "./archive";
import { detectSource } from "./detect";
import { parseEvernote } from "./evernote";
import { parseFolder } from "./folder";
import { parseKeep } from "./keep";
import type { Entries } from "./model";
import { parseNotion } from "./notion";
import { parseObsidian } from "./obsidian";

const entries = (files: Record<string, string | Uint8Array>): Entries =>
	new Map(
		Object.entries(files).map(([path, data]) => [
			path,
			typeof data === "string" ? strToU8(data) : data,
		]),
	);

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

test("Obsidian: folders nest, tags and embeds are kept, links become page links", () => {
	const { notes, skipped } = parseObsidian(
		entries({
			"Studies/Signals/Fourier.md": [
				"---",
				"tags: [math, signals]",
				"created: 2026-11-09",
				"---",
				"A signal is a sum of waves. #physics",
				"See [[Linear algebra|the matrix view]] and [[Other#Part]].",
				"![[wave.png|300]]",
				"![[missing.png]]",
				"%%private comment%%",
				"`#notatag` stays",
			].join("\n"),
			"Attachments/wave.png": PNG,
			".obsidian/app.json": "{}",
			"Board.canvas": JSON.stringify({
				nodes: [
					{ type: "text", text: "Second", x: 300, y: 0 },
					{ type: "text", text: "First", x: 0, y: 0 },
					{ type: "link", url: "https://example.com", x: 0, y: 200 },
				],
			}),
			"Empty.canvas": "{}",
		}),
	);
	expect(skipped).toEqual([
		{ source: "Empty.canvas", reason: "Canvas board has no cards" },
	]);
	const board = notes.find((x) => x.title === "Board");
	expect(board?.body.text).toBe("First\n\nSecond\n\n<https://example.com>");
	expect(notes).toHaveLength(2);
	const n = notes.find((x) => x.title === "Fourier");
	expect(n?.title).toBe("Fourier");
	expect(n?.parents).toEqual(["Studies", "Signals"]);
	expect(n?.tags.sort()).toEqual(["math", "physics", "signals"]);
	expect(n?.createdAt).toBe(Date.parse("2026-11-09"));
	expect(n?.body.text).toContain(
		"[the matrix view](https://seijaku.invalid/page/Linear%20algebra) and [Other](https://seijaku.invalid/page/Other).",
	);
	expect(n?.body.text).not.toContain("private comment");
	expect(n?.body.text).toContain("`#notatag` stays");
	expect(n?.body.text).toContain("![wave.png](seijaku-file:1)");
	expect(n?.files["seijaku-file:1"]?.bytes).toEqual(PNG);
	expect(n?.files["seijaku-file:1"]?.type).toBe("image/png");
	expect(n?.warnings).toEqual(["File not found: missing.png"]);
});

test("Notion: ids are dropped, sub-pages nest under their page, properties become tags", () => {
	const { notes, skipped } = parseNotion(
		entries({
			"Projects abc012345678abcdef0123456789abcd.md":
				"# Projects\n\nTags: work, home\nCreated: 2026-01-02\nStatus: Active\n\nSee [Studio](Projects%20abc012345678abcdef0123456789abcd/Studio%20def012345678abcdef0123456789abcd.md) and [site](https://example.com).\n",
			"Projects abc012345678abcdef0123456789abcd/Studio def012345678abcdef0123456789abcd.md":
				"# Studio\n\n![plan](Studio%20plan.png)\n",
			"Projects abc012345678abcdef0123456789abcd/Studio plan.png": PNG,
			"Tasks 111 0123456789abcdef0123456789abcdef.csv":
				'Name,Notes\nWrite,"a, b | c"\nRead,"two\nlines"\n',
			"Tasks 111 0123456789abcdef0123456789abcdef_all.csv": "Name\nx\n",
		}),
	);
	expect(skipped).toHaveLength(1);
	expect(notes.find((x) => x.title === "Tasks 111 (table)")?.body.text).toBe(
		"| Name | Notes |\n| --- | --- |\n| Write | a, b \\| c |\n| Read | two lines |",
	);
	const projects = notes.find((n) => n.title === "Projects");
	expect(projects?.parents).toEqual([]);
	expect(projects?.tags).toEqual(["work", "home"]);
	expect(projects?.createdAt).toBe(Date.parse("2026-01-02"));
	expect(projects?.body.text).toContain("Status: Active");
	expect(projects?.body.text).not.toContain("Tags:");
	expect(projects?.body.text).toContain(
		"See [Studio](https://seijaku.invalid/page/Studio) and [site](https://example.com).",
	);
	const studio = notes.find((n) => n.title === "Studio");
	expect(studio?.parents).toEqual(["Projects"]);
	expect(studio?.body.text).toBe("![plan](seijaku-file:1)");
	expect(Object.keys(studio?.files ?? {})).toEqual(["seijaku-file:1"]);
});

test("Keep: lists, labels, times, attachments, and the trash is left alone", () => {
	const note = {
		title: "Shopping",
		textContent: "",
		listContent: [
			{ text: "milk", isChecked: false },
			{ text: "eggs", isChecked: true },
		],
		labels: [{ name: "home" }],
		attachments: [{ filePath: "photo.jpg", mimetype: "image/jpeg" }],
		createdTimestampUsec: 1_700_000_000_000_000,
		userEditedTimestampUsec: 1_700_000_100_000_000,
	};
	const { notes, skipped } = parseKeep(
		entries({
			"Takeout/Keep/Shopping.json": JSON.stringify(note),
			"Takeout/Keep/photo.jpg": PNG,
			"Takeout/Keep/Old.json": JSON.stringify({
				...note,
				title: "Old",
				isTrashed: true,
			}),
			"Takeout/Keep/Labels.txt": "home",
			"Takeout/Keep/Idea.json": JSON.stringify({
				textContent: "Build a shed\nwith a roof",
				userEditedTimestampUsec: 1,
			}),
		}),
	);
	expect(skipped).toEqual([
		{ source: "Takeout/Keep/Old.json", reason: "Was in the Keep trash" },
	]);
	const shop = notes.find((n) => n.title === "Shopping");
	expect(shop?.body.text).toBe("- [ ] milk\n- [x] eggs");
	expect(shop?.tags).toEqual(["home"]);
	expect(shop?.createdAt).toBe(1_700_000_000_000);
	expect(shop?.updatedAt).toBe(1_700_000_100_000);
	expect(shop?.extras).toHaveLength(1);
	expect(shop?.extras[0]?.type).toBe("image/jpeg");
	expect(notes.find((n) => n.title === "Build a shed")).toBeDefined();
});

test("Evernote: tags, dates, pictures matched by hash, other files at the end", () => {
	const hash = Array.from(md5(PNG), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
	const pdf = new Uint8Array([37, 80, 68, 70]);
	const enex = `<?xml version="1.0"?><en-export><note>
<title>Trip &amp; plans</title>
<content><![CDATA[<?xml version="1.0"?><en-note><div>Pack <b>light</b></div><div><en-todo checked="true"/>passport</div><en-media hash="${hash}" type="image/png"/></div></en-note>]]></content>
<created>20230102T030405Z</created><updated>20230103T030405Z</updated>
<tag>travel</tag><tag>2023</tag>
<resource><data encoding="base64">${toBase64(PNG)}</data><mime>image/png</mime><resource-attributes><file-name>map.png</file-name></resource-attributes></resource>
<resource><data encoding="base64">${toBase64(pdf)}</data><mime>application/pdf</mime><resource-attributes><file-name>ticket.pdf</file-name></resource-attributes></resource>
</note></en-export>`;
	const { notes } = parseEvernote(entries({ "Travel.enex": enex }));
	expect(notes).toHaveLength(1);
	const n = notes[0];
	expect(n?.title).toBe("Trip & plans");
	expect(n?.parents).toEqual(["Travel"]);
	expect(n?.tags).toEqual(["travel", "2023"]);
	expect(n?.createdAt).toBe(Date.UTC(2023, 0, 2, 3, 4, 5));
	expect(n?.body.kind).toBe("html");
	expect(n?.body.text).toContain(`<img src="seijaku-file:${hash}">`);
	expect(n?.body.text).toContain("☑ passport");
	expect(n?.files[`seijaku-file:${hash}`]?.bytes).toEqual(PNG);
	expect(n?.extras.map((f) => f.name)).toEqual(["ticket.pdf"]);
});

test("Files and folders: HTML titles and images, Markdown headings, plain text", () => {
	const { notes } = parseFolder(
		entries({
			"Journal/2026-11-09.html":
				'<html><head><title>Rainy day</title><style>p{}</style></head><body><p>Quiet.</p><img src="Resources/pic%201.png"><script>x()</script></body></html>',
			"Journal/Resources/pic 1.png": PNG,
			"Ideas/Shed.md": "# Build a shed\n\nWood.",
			"Ideas/Plain.txt": "one\ntwo",
		}),
		["html", "markdown", "text"],
	);
	const day = notes.find((n) => n.title === "Rainy day");
	expect(day?.parents).toEqual(["Journal"]);
	expect(day?.body.text).toContain('<img src="seijaku-file:1">');
	expect(day?.body.text).not.toContain("script");
	expect(day?.body.text).not.toContain("<style");
	expect(notes.find((n) => n.title === "Build a shed")?.body.text).toBe(
		"Wood.",
	);
	expect(notes.find((n) => n.title === "Plain")?.body.kind).toBe("text");
	// Only the kinds asked for are read.
	expect(
		parseFolder(entries({ "a.md": "x", "b.txt": "y" }), ["text"]).notes,
	).toHaveLength(1);
});

test("zips are opened, even a zip inside a zip, and archiver junk is ignored", async () => {
	const inner = zipSync({ "Page abc.md": strToU8("# Page") });
	const outer = zipSync({
		"Part-1.zip": inner,
		"__MACOSX/._junk": strToU8("x"),
		".DS_Store": strToU8("x"),
		"Top.md": strToU8("top"),
	});
	const file = new File([outer as BlobPart], "Export.zip");
	const found = await readEntries([{ file, path: "Export.zip" }]);
	expect([...found.keys()].sort()).toEqual(["Page abc.md", "Top.md"]);
	const loose = await readEntries([
		{ file: new File(["hi"], "a.md"), path: "Vault/Notes/a.md" },
	]);
	expect([...loose.keys()]).toEqual(["Vault/Notes/a.md"]);
});

test("the source is worked out from the export itself", () => {
	const id32 = "0123456789abcdef0123456789abcdef";
	expect(detectSource(entries({ "Travel.enex": "<en-export/>" }))).toBe(
		"evernote",
	);
	expect(
		detectSource(
			entries({ "Vault/.obsidian/app.json": "{}", "Vault/a.md": "x" }),
		),
	).toBe("obsidian");
	expect(detectSource(entries({ "a.md": "See [[b]]", "b.md": "x" }))).toBe(
		"obsidian",
	);
	expect(detectSource(entries({ [`Page ${id32}.md`]: "# Page" }))).toBe(
		"notion",
	);
	expect(
		detectSource(
			entries({
				"Takeout/Keep/n.json": JSON.stringify({
					textContent: "x",
					userEditedTimestampUsec: 1,
				}),
			}),
		),
	).toBe("keep");
	// Plain files, HTML and text cannot be told apart from anyone's export: read as files.
	expect(
		detectSource(
			entries({ "a.md": "# hello", "b.html": "<p>x</p>", "c.txt": "y" }),
		),
	).toBe("files");
	// A JSON file that is not a Keep note is not mistaken for one.
	expect(detectSource(entries({ "settings.json": "{}", "a.md": "x" }))).toBe(
		"files",
	);
});
