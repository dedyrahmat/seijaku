import type { BlobInfo, BlobStore } from "./blobs";

/** Cloudflare blob store on R2. */
export class R2BlobStore implements BlobStore {
	constructor(private bucket: R2Bucket) {}

	async put(id: string, data: ArrayBuffer, info: BlobInfo): Promise<void> {
		await this.bucket.put(id, data, {
			httpMetadata: { contentType: info.type },
		});
	}

	async delete(id: string): Promise<void> {
		await this.bucket.delete(id);
	}

	async get(id: string) {
		const obj = await this.bucket.get(id);
		if (!obj) return null;
		return {
			body: obj.body as unknown as ReadableStream,
			info: {
				type: obj.httpMetadata?.contentType ?? "application/octet-stream",
				size: obj.size,
			},
		};
	}
}
