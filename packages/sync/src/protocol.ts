import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";

/**
 * Wire protocol between a device and the workspace room.
 *
 * The server cannot read notes: every payload is a sealed blob, and docs are named by an
 * opaque id (see `Cipher.remoteId`). It keeps an ordered log of blobs per doc and hands
 * them out; devices do the merging.
 *
 * One WebSocket carries every doc. Each binary frame is
 *   varString docId | varUint kind | kind-specific payload
 *
 *   device -> server   Subscribe(afterSeq)   "send me entries after this, then keep me posted"
 *                      Push(blob)            "store this"
 *                      Snapshot(upto, blob)  "replace entries up to `upto` with this one"
 *                      Unsubscribe
 *   server -> device   Entry(seq, blob)      one stored entry (history or live)
 *                      Ready(head, count)    that is everything stored at subscribe time
 *                      Ack(seq)              your Push is stored, at this seq
 *                      Notify                a doc you are not subscribed to changed
 *                      Resync                the server lost your subscriptions: subscribe again
 *
 * Text frames "ping" / "pong" are the keep-alive (browsers cannot send WS ping frames).
 */

export const INDEX_DOC_ID = "index";

export const FrameKind = {
	Ack: 1,
	Notify: 2,
	/** Device no longer wants live entries for this doc. */
	Unsubscribe: 3,
	/** Server lost its per-socket state (a Durable Object woke from hibernation). */
	Resync: 4,
	Subscribe: 5,
	Push: 6,
	Entry: 7,
	Ready: 8,
	Snapshot: 9,
	/** Device deleted the note for good: the server drops its log. */
	Drop: 10,
} as const;
export type FrameKind = (typeof FrameKind)[keyof typeof FrameKind];

/** What the server calls a doc: `d` and 32 hex characters. Anything else is refused. */
const REMOTE_DOC_ID = /^d[a-f0-9]{32}$/;

export function isValidDocId(id: string): boolean {
	return REMOTE_DOC_ID.test(id);
}

/** A local doc id: the index, or `note-<id>` where id is generated or `daily-YYYY-MM-DD`. */
const LOCAL_DOC_ID = /^(index|note-[A-Za-z0-9_-]{1,64})$/;

export function isValidLocalDocId(id: string): boolean {
	return LOCAL_DOC_ID.test(id);
}

/** Local (readable) id of a note's doc. Never sent to the server as is. */
export function noteDocId(noteId: string): string {
	return `note-${noteId}`;
}

/** Largest frame the room accepts (guards memory; a note rarely approaches this). */
export const MAX_FRAME_BYTES = 8 * 1024 * 1024;

/** Used when a doc has no resync target of its own (Resync frames name no doc). */
export const RESYNC_DOC_ID = `d${"0".repeat(32)}`;

export const PING = "ping";
export const PONG = "pong";

function begin(docId: string, kind: FrameKind): encoding.Encoder {
	const enc = encoding.createEncoder();
	encoding.writeVarString(enc, docId);
	encoding.writeVarUint(enc, kind);
	return enc;
}

export function encodeSubscribe(docId: string, afterSeq: number): Uint8Array {
	const enc = begin(docId, FrameKind.Subscribe);
	encoding.writeVarUint(enc, afterSeq);
	return encoding.toUint8Array(enc);
}

export function encodePush(docId: string, blob: Uint8Array): Uint8Array {
	const enc = begin(docId, FrameKind.Push);
	encoding.writeVarUint8Array(enc, blob);
	return encoding.toUint8Array(enc);
}

export function encodeSnapshot(
	docId: string,
	upto: number,
	blob: Uint8Array,
): Uint8Array {
	const enc = begin(docId, FrameKind.Snapshot);
	encoding.writeVarUint(enc, upto);
	encoding.writeVarUint8Array(enc, blob);
	return encoding.toUint8Array(enc);
}

export function encodeEntry(
	docId: string,
	seq: number,
	blob: Uint8Array,
): Uint8Array {
	const enc = begin(docId, FrameKind.Entry);
	encoding.writeVarUint(enc, seq);
	encoding.writeVarUint8Array(enc, blob);
	return encoding.toUint8Array(enc);
}

export function encodeReady(
	docId: string,
	head: number,
	count: number,
): Uint8Array {
	const enc = begin(docId, FrameKind.Ready);
	encoding.writeVarUint(enc, head);
	encoding.writeVarUint(enc, count);
	return encoding.toUint8Array(enc);
}

export function encodeAck(docId: string, seq: number): Uint8Array {
	const enc = begin(docId, FrameKind.Ack);
	encoding.writeVarUint(enc, seq);
	return encoding.toUint8Array(enc);
}

export function encodeNotify(docId: string): Uint8Array {
	return encoding.toUint8Array(begin(docId, FrameKind.Notify));
}

export function encodeUnsubscribe(docId: string): Uint8Array {
	return encoding.toUint8Array(begin(docId, FrameKind.Unsubscribe));
}

export function encodeDrop(docId: string): Uint8Array {
	return encoding.toUint8Array(begin(docId, FrameKind.Drop));
}

export function encodeResync(): Uint8Array {
	return encoding.toUint8Array(begin(RESYNC_DOC_ID, FrameKind.Resync));
}

export type DecodedFrame =
	| { kind: typeof FrameKind.Subscribe; docId: string; afterSeq: number }
	| { kind: typeof FrameKind.Push; docId: string; blob: Uint8Array }
	| {
			kind: typeof FrameKind.Snapshot;
			docId: string;
			upto: number;
			blob: Uint8Array;
	  }
	| {
			kind: typeof FrameKind.Entry;
			docId: string;
			seq: number;
			blob: Uint8Array;
	  }
	| {
			kind: typeof FrameKind.Ready;
			docId: string;
			head: number;
			count: number;
	  }
	| { kind: typeof FrameKind.Ack; docId: string; seq: number }
	| { kind: typeof FrameKind.Notify; docId: string }
	| { kind: typeof FrameKind.Unsubscribe; docId: string }
	| { kind: typeof FrameKind.Drop; docId: string }
	| { kind: typeof FrameKind.Resync; docId: string };

/** Returns null for anything malformed or unknown instead of throwing. */
export function decodeFrame(data: Uint8Array): DecodedFrame | null {
	try {
		const dec = decoding.createDecoder(data);
		const docId = decoding.readVarString(dec);
		const kind = decoding.readVarUint(dec);
		if (!isValidDocId(docId)) return null;
		switch (kind) {
			case FrameKind.Subscribe:
				return { kind, docId, afterSeq: decoding.readVarUint(dec) };
			case FrameKind.Push:
				return { kind, docId, blob: decoding.readVarUint8Array(dec) };
			case FrameKind.Snapshot: {
				const upto = decoding.readVarUint(dec);
				return { kind, docId, upto, blob: decoding.readVarUint8Array(dec) };
			}
			case FrameKind.Entry: {
				const seq = decoding.readVarUint(dec);
				return { kind, docId, seq, blob: decoding.readVarUint8Array(dec) };
			}
			case FrameKind.Ready: {
				const head = decoding.readVarUint(dec);
				return { kind, docId, head, count: decoding.readVarUint(dec) };
			}
			case FrameKind.Ack:
				return { kind, docId, seq: decoding.readVarUint(dec) };
			case FrameKind.Notify:
			case FrameKind.Unsubscribe:
			case FrameKind.Drop:
			case FrameKind.Resync:
				return { kind, docId };
			default:
				return null;
		}
	} catch {
		return null;
	}
}
