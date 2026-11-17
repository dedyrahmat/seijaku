import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BLOB_ID, type BlobInfo, type BlobStore } from "./blobs";

/** Self-host blob store: one file per upload, plus a small sidecar holding its content type. */
export class DiskBlobStore implements BlobStore {
	constructor(private dir: string) {}

	private path(id: string): string {
		if (!BLOB_ID.test(id)) throw new Error("bad blob id");
		return join(this.dir, id);
	}

	async put(id: string, data: ArrayBuffer, info: BlobInfo): Promise<void> {
		await mkdir(this.dir, { recursive: true });
		await writeFile(this.path(id), new Uint8Array(data));
		await writeFile(`${this.path(id)}.json`, JSON.stringify(info));
	}

	async delete(id: string): Promise<void> {
		await rm(this.path(id), { force: true });
		await rm(`${this.path(id)}.json`, { force: true });
	}

	async get(id: string) {
		try {
			const [bytes, meta] = await Promise.all([
				readFile(this.path(id)),
				readFile(`${this.path(id)}.json`, "utf8"),
			]);
			const info = JSON.parse(meta) as BlobInfo;
			const body = bytes.buffer.slice(
				bytes.byteOffset,
				bytes.byteOffset + bytes.byteLength,
			) as ArrayBuffer;
			return { body, info };
		} catch {
			return null;
		}
	}
}
