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
	/** For the file picker. */
	accept: string;
	/** Offer a folder picker too. */
	folder: boolean;
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
		accept: ".md,.zip",
		folder: true,
		parse: parseObsidian,
	},
	{
		id: "notion",
		name: "Notion",
		mono: "N",
		accept: ".zip",
		folder: false,
		parse: parseNotion,
	},
	{
		id: "keep",
		name: "Google Keep",
		mono: "K",
		accept: ".zip,.json",
		folder: true,
		parse: parseKeep,
	},
	{
		id: "evernote",
		name: "Evernote",
		mono: "E",
		accept: ".enex",
		folder: false,
		parse: parseEvernote,
	},
	{
		id: "apple-notes",
		name: "Apple Notes",
		mono: "A",
		accept: ".zip,.html,.htm,.md,.txt",
		folder: true,
		parse: folderOf("html", "markdown", "text"),
	},
	{
		id: "apple-journal",
		name: "Apple Journal",
		mono: "J",
		accept: ".zip,.html,.htm,.md,.txt",
		folder: true,
		parse: folderOf("html", "markdown", "text"),
	},
	{
		id: "markdown",
		name: "Markdown",
		mono: "Md",
		accept: ".md,.markdown,.zip",
		folder: true,
		parse: folderOf("markdown"),
	},
	{
		id: "html",
		name: "HTML",
		mono: "</>",
		accept: ".html,.htm,.zip",
		folder: true,
		parse: folderOf("html"),
	},
	{
		id: "text",
		name: "Plain text",
		mono: "Tx",
		accept: ".txt,.zip",
		folder: false,
		parse: folderOf("text"),
	},
];

/** What anything else is read as: files and folders of Markdown, HTML or text. */
const FILES: Source = {
	id: "files",
	name: "your files",
	mono: "",
	accept: "",
	folder: true,
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
