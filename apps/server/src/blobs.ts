/**
 * Where uploaded files live. Disk for self-host (disk-blobs.ts), R2 on Cloudflare
 * (r2-blobs.ts). Shared code only sees this interface.
 */
export interface BlobInfo {
	type: string;
	size: number;
}

export interface BlobStore {
	put(id: string, data: ArrayBuffer, info: BlobInfo): Promise<void>;
	delete(id: string): Promise<void>;
	get(
		id: string,
	): Promise<{ body: ReadableStream | ArrayBuffer; info: BlobInfo } | null>;
}

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** 24 hex chars: unguessable, so a file's address is also its access control until auth lands. */
export function newBlobId(): string {
	const bytes = new Uint8Array(12);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The address of a sealed file is the first 12 bytes of its SHA-256. The client can compute it
 * before uploading, so a file added offline already has its final address, and the server can
 * check the bytes match it.
 */
export async function blobIdFor(data: ArrayBuffer): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
	return Array.from(digest.subarray(0, 12), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
}

export const BLOB_ID = /^[a-f0-9]{24}$/;

/** Types the browser may display in place. Anything else is only ever offered as a download. */
const INLINE_TYPES = new Set([
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"image/avif",
	"image/svg+xml",
	"video/mp4",
	"video/webm",
	"audio/mpeg",
	"audio/ogg",
	"audio/wav",
	"audio/mp4",
	"application/pdf",
]);

export function isInlineType(type: string): boolean {
	return INLINE_TYPES.has(type);
}

/** Reduces a client-supplied content type to something safe to store. */
export function cleanType(raw: string | undefined | null): string {
	const t = (raw ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
	return /^[a-z]+\/[a-z0-9.+-]+$/.test(t) ? t : "application/octet-stream";
}

/**
 * Reads a request body of at most `max` bytes, or returns null as soon as it grows past that.
 * `Content-Length` can be left out or wrong, so the bytes themselves are counted.
 */
export async function readBody(
	req: Request,
	max: number,
): Promise<ArrayBuffer | null> {
	if (Number(req.headers.get("content-length") ?? 0) > max) return null;
	const reader = req.body?.getReader();
	if (!reader) return new ArrayBuffer(0);
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > max) {
			await reader.cancel().catch(() => undefined);
			return null;
		}
		chunks.push(value);
	}
	const out = new Uint8Array(size);
	let at = 0;
	for (const c of chunks) {
		out.set(c, at);
		at += c.byteLength;
	}
	return out.buffer as ArrayBuffer;
}

/** A JSON request body of at most `max` bytes. */
export async function readJson(
	req: Request,
	max: number,
): Promise<{ ok: true; value: unknown } | { ok: false; status: 400 | 413 }> {
	const body = await readBody(req, max);
	if (!body) return { ok: false, status: 413 };
	try {
		return { ok: true, value: JSON.parse(new TextDecoder().decode(body)) };
	} catch {
		return { ok: false, status: 400 };
	}
}

/** Room for a sealed upload of `MAX_UPLOAD_BYTES` carried as base64 inside JSON. */
export const MAX_JSON_BYTES = Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 8192;
