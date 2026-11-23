import { unzipSync } from "fflate";
import type { Entries } from "./model";

/** A file the person gave us, with the folder path it had (empty for a plain file). */
export interface Picked {
	path: string;
	file: File;
}

const MAX_BYTES = 1_500_000_000;
const MAX_NESTED = 2;

/** Junk that archivers add: never part of anyone's notes. */
const JUNK = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)(\/|$)/;

function clean(path: string): string {
	return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

/** Opens a zip, refusing before anything is inflated if its files would pass the size limit. */
function unzip(bytes: Uint8Array, total: { bytes: number }) {
	let planned = total.bytes;
	return unzipSync(bytes, {
		filter: (file) => {
			planned += file.originalSize;
			if (planned > MAX_BYTES) throw new TooBig();
			return true;
		},
	});
}

class TooBig extends Error {
	constructor() {
		super("That export is larger than 1.5 GB. Import it in parts.");
	}
}

function add(
	into: Entries,
	path: string,
	bytes: Uint8Array,
	depth: number,
	total: { bytes: number },
): void {
	const name = clean(path);
	if (!name || name.endsWith("/") || JUNK.test(name)) return;
	total.bytes += bytes.byteLength;
	if (total.bytes > MAX_BYTES)
		throw new Error("That export is larger than 1.5 GB. Import it in parts.");
	if (/\.zip$/i.test(name) && depth < MAX_NESTED) {
		// Notion wraps big exports in zips inside the zip; open them as if they were folders.
		let inner: Record<string, Uint8Array> | null = null;
		try {
			inner = unzip(bytes, total);
		} catch (err) {
			if (err instanceof TooBig) throw err;
			// Not really a zip: keep it as a file.
		}
		if (inner) {
			for (const [name, data] of Object.entries(inner))
				add(into, name, data, depth + 1, total);
			return;
		}
	}
	into.set(name, bytes);
}

/** Reads everything the person picked into one map, opening zips (and zips inside zips). */
export async function readEntries(picked: Picked[]): Promise<Entries> {
	const entries: Entries = new Map();
	const total = { bytes: 0 };
	for (const { path, file } of picked) {
		const bytes = new Uint8Array(await file.arrayBuffer());
		if (/\.zip$/i.test(file.name)) {
			let inner: Record<string, Uint8Array>;
			try {
				inner = unzip(bytes, total);
			} catch (err) {
				if (err instanceof TooBig) throw err;
				throw new Error(`${file.name} is not a zip file that can be opened.`);
			}
			for (const [name, data] of Object.entries(inner))
				add(entries, name, data, 1, total);
			continue;
		}
		add(entries, path || file.name, bytes, 0, total);
	}
	return entries;
}

/** Files from a file picker, including a chosen folder (which carries relative paths). */
export function pickedFromInput(files: FileList | File[]): Picked[] {
	return [...files].map((file) => ({
		file,
		path: file.webkitRelativePath || file.name,
	}));
}

async function walk(entry: FileSystemEntry, out: Picked[]): Promise<void> {
	if (entry.isFile) {
		const file = await new Promise<File>((ok, fail) =>
			(entry as FileSystemFileEntry).file(ok, fail),
		);
		out.push({ file, path: clean(entry.fullPath) });
	} else if (entry.isDirectory) {
		const reader = (entry as FileSystemDirectoryEntry).createReader();
		// readEntries returns at most ~100 at a time: keep asking until it is empty.
		for (;;) {
			const batch = await new Promise<FileSystemEntry[]>((ok, fail) =>
				reader.readEntries(ok, fail),
			);
			if (batch.length === 0) break;
			for (const child of batch) await walk(child, out);
		}
	}
}

/** Files from a drop, walking into any folders that were dropped. */
export async function pickedFromDrop(data: DataTransfer): Promise<Picked[]> {
	const out: Picked[] = [];
	const entries = [...data.items]
		.map((item) => item.webkitGetAsEntry())
		.filter((e): e is FileSystemEntry => e !== null);
	if (entries.length === 0) return pickedFromInput(data.files);
	for (const entry of entries) await walk(entry, out);
	return out;
}
