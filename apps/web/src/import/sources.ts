import { type Picked, readEntries } from "./archive";
import { detectSource } from "./detect";
import { parseEvernote } from "./evernote";
import { type FolderKind, parseFolder } from "./folder";
import { parseKeep } from "./keep";
import type { Entries, Parsed } from "./model";
import { parseNotion } from "./notion";
import { parseObsidian } from "./obsidian";

/** Everything the Import page needs to know about one place notes can come from. */
export interface Source {
	id: string;
	name: string;
	mono: string;
	hint: string;
	/** For the file picker. */
	accept: string;
	/** Offer a folder picker too. */
	folder: boolean;
	drop: string;
	parse: (entries: Entries) => Parsed;
}

const folderOf =
	(...kinds: FolderKind[]) =>
	(entries: Entries) =>
		parseFolder(entries, kinds);

export const SOURCES: Source[] = [
	{
		id: "obsidian",
		name: "Obsidian",
		mono: "O",
		hint: "Vault folder or .zip",
		accept: ".md,.zip",
		folder: true,
		drop: "Drop your Obsidian vault here, as a folder or a .zip",
		parse: parseObsidian,
	},
	{
		id: "notion",
		name: "Notion",
		mono: "N",
		hint: "Export .zip (Markdown)",
		accept: ".zip",
		folder: false,
		drop: "Drop your Notion export (.zip) here",
		parse: parseNotion,
	},
	{
		id: "keep",
		name: "Google Keep",
		mono: "K",
		hint: "Takeout .zip",
		accept: ".zip,.json",
		folder: true,
		drop: "Drop your Takeout .zip, or the Keep folder, here",
		parse: parseKeep,
	},
	{
		id: "evernote",
		name: "Evernote",
		mono: "E",
		hint: ".enex files",
		accept: ".enex",
		folder: false,
		drop: "Drop your .enex files here",
		parse: parseEvernote,
	},
	{
		id: "apple-notes",
		name: "Apple Notes",
		mono: "A",
		hint: "Exported notes",
		accept: ".zip,.html,.htm,.md,.txt",
		folder: true,
		drop: "Drop your exported notes here, as files, a folder or a .zip",
		parse: folderOf("html", "markdown", "text"),
	},
	{
		id: "apple-journal",
		name: "Apple Journal",
		mono: "J",
		hint: "Exported entries",
		accept: ".zip,.html,.htm,.md,.txt",
		folder: true,
		drop: "Drop your exported entries here, as files, a folder or a .zip",
		parse: folderOf("html", "markdown", "text"),
	},
	{
		id: "markdown",
		name: "Markdown",
		mono: "Md",
		hint: "Files or folder",
		accept: ".md,.markdown,.zip",
		folder: true,
		drop: "Drop your Markdown files or a folder here",
		parse: folderOf("markdown"),
	},
	{
		id: "html",
		name: "HTML",
		mono: "</>",
		hint: "Files or folder",
		accept: ".html,.htm,.zip",
		folder: true,
		drop: "Drop your HTML files or a folder here",
		parse: folderOf("html"),
	},
	{
		id: "text",
		name: "Plain text",
		mono: "Tx",
		hint: ".txt files",
		accept: ".txt,.zip",
		folder: false,
		drop: "Drop your text files here",
		parse: folderOf("text"),
	},
];

/** What anything else is read as: files and folders of Markdown, HTML or text. */
const FILES: Source = {
	id: "files",
	name: "your files",
	mono: "",
	hint: "",
	accept: "",
	folder: true,
	drop: "",
	parse: folderOf("html", "markdown", "text"),
};

/** Every kind of file any source accepts, for the picker when no source was chosen. */
export const ANY_ACCEPT = ".zip,.md,.markdown,.html,.htm,.txt,.enex,.json";

/**
 * Reads what was picked (opening zips) and turns it into notes. With no source chosen, the
 * export is looked at and the source worked out from it; a chosen source overrides that.
 */
export async function readSource(
	chosenId: string | null,
	picked: Picked[],
): Promise<{ source: Source; parsed: Parsed }> {
	const entries = await readEntries(picked);
	const id = chosenId ?? detectSource(entries);
	const source = SOURCES.find((s) => s.id === id) ?? FILES;
	return { source, parsed: source.parse(entries) };
}
