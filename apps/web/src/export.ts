import { BlockNoteEditor } from "@blocknote/core";
import { yXmlFragmentToBlocks } from "@blocknote/core/yjs";
import {
	buildTree,
	listNotes,
	type NoteMeta,
	type TreeNode,
} from "@seijaku/sync";
import { strToU8, zipSync } from "fflate";
import { schema } from "./editor/schema";
import { readFile } from "./workspace/files";
import { workspace } from "./workspace/store";

/**
 * Markdown export: one file per page, laid out like the page tree, with every image and
 * attachment opened on this device and put in an `attachments` folder. Nothing leaves the
 * device: the files are sealed on the server, so the zip is made here.
 */

interface Block {
	type: string;
	props: Record<string, unknown>;
	content?: unknown;
	children: Block[];
}

const MEDIA = new Set(["image", "video", "audio", "file"]);

let editor: BlockNoteEditor<never, never, never> | null = null;
const headless = () =>
	(editor ??= BlockNoteEditor.create({ schema }) as unknown as BlockNoteEditor<
		never,
		never,
		never
	>);

function textOf(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.map((c: { text?: string }) => c.text ?? "")
		.join("")
		.trim();
}

/** Collects the files a page refers to and hands back where each one is stored in the zip. */
class Attachments {
	readonly files = new Map<string, Uint8Array>();
	private byUrl = new Map<string, string>();

	async add(url: string): Promise<string | null> {
		const known = this.byUrl.get(url);
		if (known) return known;
		const file = await readFile(url);
		if (!file) return null;
		const clean = file.name.replace(/[\\/:*?"<>|]+/g, "-") || "file";
		let path = `attachments/${clean}`;
		for (let n = 2; this.files.has(path); n++)
			path = `attachments/${n}-${clean}`;
		this.files.set(path, file.bytes);
		this.byUrl.set(url, path);
		return path;
	}
}

/** Custom blocks have no Markdown form of their own: write them as the nearest plain one. */
async function flatten(
	blocks: Block[],
	attachments: Attachments,
	up: string,
): Promise<Block[]> {
	const out: Block[] = [];
	for (const b of blocks) {
		const children = await flatten(b.children, attachments, up);
		if (b.type === "callout")
			out.push({ ...b, type: "quote", props: {}, children });
		else if (b.type === "math")
			out.push({
				type: "paragraph",
				props: {},
				content: `$$ ${textOf(b.content)} $$`,
				children,
			});
		else if (b.type === "linkPreview") {
			const url = String(b.props.url ?? "");
			if (!url) continue;
			out.push({
				type: "paragraph",
				props: {},
				content: [
					{
						type: "link",
						href: url,
						content: [
							{ type: "text", text: String(b.props.title || url), styles: {} },
						],
					},
				],
				children,
			});
		} else if (
			MEDIA.has(b.type) &&
			String(b.props.url ?? "").includes("/api/files/")
		) {
			const path = await attachments.add(String(b.props.url));
			out.push({
				...b,
				props: path ? { ...b.props, url: up + path } : b.props,
				children,
			});
		} else out.push({ ...b, children });
	}
	return out;
}

async function pageMarkdown(
	note: NoteMeta,
	attachments: Attachments,
	depth: number,
): Promise<string> {
	const ed = headless();
	const blocks = await workspace.withFragment(note.id, (fragment) =>
		yXmlFragmentToBlocks(ed, fragment),
	);
	const flat = await flatten(
		blocks as unknown as Block[],
		attachments,
		"../".repeat(depth),
	);
	const body = ed.blocksToMarkdownLossy(flat as never).trim();
	const tags = note.tags.length
		? `${note.tags.map((t) => `#${t}`).join(" ")}\n\n`
		: "";
	return `# ${note.title || "Untitled"}\n\n${tags}${body}\n`;
}

const safe = (title: string) =>
	title.replace(/[\\/:*?"<>|]+/g, "-").trim() || "Untitled";

/** Lays the page tree out as paths: a page with sub-pages gets a folder of the same name. */
function paths(tree: TreeNode[], prefix = "", taken = new Set<string>()) {
	const out: { note: NoteMeta; path: string; depth: number }[] = [];
	for (const node of tree) {
		let base = prefix + safe(node.note.title);
		for (let n = 2; taken.has(base.toLowerCase()); n++)
			base = `${prefix}${safe(node.note.title)} (${n})`;
		taken.add(base.toLowerCase());
		out.push({
			note: node.note,
			path: `${base}.md`,
			depth: prefix.split("/").length - 1,
		});
		out.push(...paths(node.children, `${base}/`, taken));
	}
	return out;
}

function save(name: string, data: Uint8Array | string, type: string): void {
	const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
	const a = document.createElement("a");
	a.href = url;
	a.download = name;
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Exports one page: a .md file, or a zip when it has images or files. */
export async function exportPage(note: NoteMeta): Promise<void> {
	const attachments = new Attachments();
	const md = await pageMarkdown(note, attachments, 0);
	const name = safe(note.title);
	if (attachments.files.size === 0)
		return save(`${name}.md`, md, "text/markdown");
	const zip = zipSync({
		[`${name}.md`]: strToU8(md),
		...Object.fromEntries(attachments.files),
	});
	save(`${name}.zip`, zip, "application/zip");
}

/** Exports every page that is not in the trash as one zip. */
export async function exportWorkspace(): Promise<number> {
	const attachments = new Attachments();
	const live = listNotes(workspace.index).filter((n) => !n.trashed);
	const entries = paths(buildTree(live));
	const zipped: Record<string, Uint8Array> = {};
	for (const { note, path, depth } of entries)
		zipped[path] = strToU8(await pageMarkdown(note, attachments, depth));
	for (const [path, bytes] of attachments.files) zipped[path] = bytes;
	const stamp = new Date().toISOString().slice(0, 10);
	save(`seijaku-export-${stamp}.zip`, zipSync(zipped), "application/zip");
	return entries.length;
}
