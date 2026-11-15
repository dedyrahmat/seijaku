import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import type * as Y from "yjs";

/**
 * Wire protocol between a device and the workspace room.
 *
 * One WebSocket carries every doc of the workspace. Each binary frame is
 *   varString docId | varUint kind | kind-specific payload
 * where `sync` frames hold a y-protocols sync message (step 1, step 2 or update),
 * `ack` is the server confirming it has stored an update, and `notify` tells a
 * device that a doc it is not subscribed to has changed.
 *
 * Text frames "ping" / "pong" are the keep-alive (browsers cannot send WS ping frames).
 */

export const INDEX_DOC_ID = "index";

export const FrameKind = {
	Sync: 0,
	Ack: 1,
	Notify: 2,
	/** Client no longer wants live updates for this doc. */
	Unsubscribe: 3,
	/** Server lost its per-socket state (a Durable Object woke from hibernation): subscribe again. */
	Resync: 4,
} as const;
export type FrameKind = (typeof FrameKind)[keyof typeof FrameKind];

/** The index doc, or `note-<id>` where id is a generated id or `daily-YYYY-MM-DD`. */
const DOC_ID = /^(index|note-[A-Za-z0-9_-]{1,64})$/;

export function isValidDocId(id: string): boolean {
	return DOC_ID.test(id);
}

export function noteDocId(noteId: string): string {
	return `note-${noteId}`;
}

/** Largest frame the room accepts (guards memory; a note rarely approaches this). */
export const MAX_FRAME_BYTES = 8 * 1024 * 1024;

export const PING = "ping";
export const PONG = "pong";

function begin(docId: string, kind: FrameKind): encoding.Encoder {
	const enc = encoding.createEncoder();
	encoding.writeVarString(enc, docId);
	encoding.writeVarUint(enc, kind);
	return enc;
}

/** Step 1 of the handshake: "here is what I have, send me what I am missing". */
export function encodeSyncStep1(docId: string, doc: Y.Doc): Uint8Array {
	const enc = begin(docId, FrameKind.Sync);
	syncProtocol.writeSyncStep1(enc, doc);
	return encoding.toUint8Array(enc);
}

export function encodeUpdate(docId: string, update: Uint8Array): Uint8Array {
	const enc = begin(docId, FrameKind.Sync);
	syncProtocol.writeUpdate(enc, update);
	return encoding.toUint8Array(enc);
}

export function encodeAck(docId: string): Uint8Array {
	return encoding.toUint8Array(begin(docId, FrameKind.Ack));
}

export function encodeNotify(docId: string): Uint8Array {
	return encoding.toUint8Array(begin(docId, FrameKind.Notify));
}

export function encodeUnsubscribe(docId: string): Uint8Array {
	return encoding.toUint8Array(begin(docId, FrameKind.Unsubscribe));
}

export function encodeResync(): Uint8Array {
	return encoding.toUint8Array(begin(INDEX_DOC_ID, FrameKind.Resync));
}

export type DecodedFrame =
	| { kind: typeof FrameKind.Sync; docId: string; body: decoding.Decoder }
	| { kind: typeof FrameKind.Ack; docId: string }
	| { kind: typeof FrameKind.Notify; docId: string }
	| { kind: typeof FrameKind.Unsubscribe; docId: string }
	| { kind: typeof FrameKind.Resync; docId: string };

/** Returns null for anything malformed or unknown instead of throwing. */
export function decodeFrame(data: Uint8Array): DecodedFrame | null {
	try {
		const dec = decoding.createDecoder(data);
		const docId = decoding.readVarString(dec);
		const kind = decoding.readVarUint(dec);
		if (!isValidDocId(docId)) return null;
		if (kind === FrameKind.Sync) return { kind, docId, body: dec };
		if (kind === FrameKind.Ack) return { kind, docId };
		if (kind === FrameKind.Notify) return { kind, docId };
		if (kind === FrameKind.Unsubscribe) return { kind, docId };
		if (kind === FrameKind.Resync) return { kind, docId };
		return null;
	} catch {
		return null;
	}
}

export interface SyncResult {
	/** Frame to send back, when the message asked for a reply. */
	reply: Uint8Array | null;
	/** True when the message carried document content (step 2 or update). */
	carriedData: boolean;
	/** True for a step 2, the answer to our step 1. */
	wasStep2: boolean;
	/** True for a step 1, i.e. the peer asked us for our state. */
	wasStep1: boolean;
}

/**
 * Applies one sync message body to `doc`. Throws if the message is malformed
 * or the update cannot be applied; callers drop the frame in that case.
 */
export function applySyncMessage(
	docId: string,
	body: decoding.Decoder,
	doc: Y.Doc,
	origin: unknown,
): SyncResult {
	const type = decoding.peekVarUint(body);
	const enc = begin(docId, FrameKind.Sync);
	const start = encoding.length(enc);
	syncProtocol.readSyncMessage(body, enc, doc, origin);
	return {
		reply: encoding.length(enc) > start ? encoding.toUint8Array(enc) : null,
		carriedData:
			type === syncProtocol.messageYjsSyncStep2 ||
			type === syncProtocol.messageYjsUpdate,
		wasStep2: type === syncProtocol.messageYjsSyncStep2,
		wasStep1: type === syncProtocol.messageYjsSyncStep1,
	};
}
