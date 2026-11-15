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
