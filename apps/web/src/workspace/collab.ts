import {
	createCipher,
	type DocSyncState,
	fromBase64,
	NOTE_FRAGMENT,
	newKeyPair,
	newWorkspaceKey,
	openInvite,
	SyncClient,
	sealInvite,
	toBase64,
	unwrapKeyWith,
	wrapKeyFor,
} from "@seijaku/sync";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { authStore } from "../auth/session";
import { getPrefs } from "../preferences";
import { type NoteSession, workspace } from "./store";
import { apiUrl, currentSyncUrl } from "./syncUrl";

/**
 * Pages shared with other accounts (docs/COLLABORATIVE-SHARING.md). Each shared page has a
 * page key; this device keeps it in the index doc (sealed like everything there) next to the
 * role. A shared page syncs through a second `SyncClient` aimed at the page's own room and
 * sealed with the page key. The owner's note doc is attached to both clients, so edits from
 * members reach the owner's own copy and the owner's edits reach members; a member's copy is a
 * doc of its own, kept in IndexedDB.
 */

export type Role = "owner" | "editor" | "reader";

export interface CollabEntry {
	/** The page key, base64. */
	key: string;
	role: Role;
	epoch: number;
	owner: boolean;
	/** The owner's own note. Members have none. */
	noteId?: string;
	/** This account's member row on the server, to leave with. */
	memberId?: string;
	/** Last known title (members read it from the shared doc). */
	title?: string;
	/** The page stopped being shared or this account lost access; the local copy stays readable. */
	ended?: boolean;
	/** The owner removed someone and the new key has not reached the server yet. */
	rotating?: boolean;
	since: number;
}

export interface Person {
	memberId: string;
	role: Role;
	label: string;
	you: boolean;
	publicKey: string | null;
}
export interface Invite {
	id: string;
	role: Role;
	label: string;
	expiresAt: number;
}

const PAGE = "page";
const POLL_MS = 20_000;

const sharedSyncUrl = (shareId: string): string => {
	const url = currentSyncUrl();
	const q = url.indexOf("?");
	const base = q < 0 ? url : url.slice(0, q);
	return `${base}/shared/${shareId}${q < 0 ? "" : url.slice(q)}`;
};

async function call<T>(
	method: string,
	path: string,
	body?: unknown,
): Promise<{ ok: boolean; status: number; data: T | null }> {
	const res = await fetch(apiUrl(path), {
		method,
		credentials: "include",
		headers: body === undefined ? {} : { "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	return {
		ok: res.ok,
		status: res.status,
		data: res.ok ? ((await res.json().catch(() => null)) as T | null) : null,
	};
}

interface Live {
	client: SyncClient;
	key: string;
	doc: Y.Doc;
	detach: () => void;
}

interface MemberDoc extends NoteSession {
	persistence: IndexeddbPersistence;
}

class Collab {
	private snapshot: [string, CollabEntry][] = [];
	private listeners = new Set<() => void>();
	private live = new Map<string, Live>();
	private memberDocs = new Map<string, MemberDoc>();

	private get map() {
		return workspace.index.getMap<CollabEntry>("collab");
	}

	constructor() {
		void workspace.ready.then(() => {
			this.map.observe(() => {
				this.read();
				void this.connectAll();
			});
			this.read();
			authStore.subscribe(() => void this.connectAll());
			workspace.subscribe(() => this.pushTitles());
			document.addEventListener("visibilitychange", () => {
				if (document.visibilityState === "visible") void this.refresh();
			});
			setInterval(() => {
				if (document.visibilityState === "visible" && this.snapshot.length)
					void this.refresh();
			}, POLL_MS);
			void this.connectAll();
			void this.refresh();
		});
	}

	private read(): void {
		this.snapshot = [...this.map.entries()].sort(
			(a, b) => a[1].since - b[1].since,
		);
		for (const l of this.listeners) l();
	}

	subscribe = (l: () => void): (() => void) => {
		this.listeners.add(l);
		return () => this.listeners.delete(l);
	};
	getEntries = (): [string, CollabEntry][] => this.snapshot;

	entry(shareId: string): CollabEntry | undefined {
		return this.map.get(shareId);
	}
	entryForNote(noteId: string): [string, CollabEntry] | undefined {
		return this.snapshot.find(([, e]) => e.noteId === noteId && !e.ended);
	}
	private put(shareId: string, patch: Partial<CollabEntry>): void {
		const cur = this.map.get(shareId);
		if (cur) this.map.set(shareId, { ...cur, ...patch });
	}

	// --- key pair -----------------------------------------------------------

	/** This account's key pair; made once, kept sealed in the index doc, public half sent to the server. */
	private async keyPair(): Promise<{
		secret: Uint8Array;
		publicKey: Uint8Array;
	}> {
		const store = workspace.index.getMap<{ secret: string; publicKey: string }>(
			"collabKey",
		);
		let pair = store.get("pair");
		if (!pair) {
			const made = newKeyPair();
			pair = {
				secret: toBase64(made.secret),
				publicKey: toBase64(made.publicKey),
			};
			store.set("pair", pair);
		}
		await call("PUT", "/api/shared/key", { publicKey: pair.publicKey });
		return {
			secret: fromBase64(pair.secret),
			publicKey: fromBase64(pair.publicKey),
		};
	}

	// --- connections --------------------------------------------------------

	/** Opens (or reopens, after a key change) a connection for every shared page that needs one. */
	private async connectAll(): Promise<void> {
		const signedIn = authStore.getState().phase === "signed-in";
		const want = new Set<string>();
		for (const [id, e] of this.snapshot) {
			if (e.ended || !signedIn || getPrefs().workOffline) continue;
			want.add(id);
			const have = this.live.get(id);
			if (have && have.key === e.key) continue;
			if (have) this.disconnect(id);
			await this.connect(id, e);
		}
		for (const id of [...this.live.keys()])
			if (!want.has(id)) this.disconnect(id);
	}

	private async connect(shareId: string, e: CollabEntry): Promise<void> {
		const session =
			e.owner && e.noteId
				? workspace.openNote(e.noteId)
				: this.openShared(shareId);
		await session.ready;
		if (this.live.has(shareId)) return;
		const cipher = createCipher(fromBase64(e.key));
		const client = new SyncClient({
			url: () => sharedSyncUrl(shareId),
			cipher: () => cipher,
			onConnectFailed: () => void this.refresh(),
		});
		const mem = this.memberDocs.get(shareId);
		const saved = mem
			? ((await mem.persistence
					.get("sync")
					.catch(() => null)) as DocSyncState | null)
			: null;
		const attachment = client.attach(PAGE, session.doc, {
			quiet: true,
			state: saved ?? null,
			onState: mem
				? (s) => void mem.persistence.set("sync", s as never)
				: undefined,
		});
		// Every time the connection comes back (after a removal, a role change or a new key), look again.
		let was = "offline";
		client.subscribe(() => {
			const now = client.getState().status;
			if (was === "offline" && now !== "offline") void this.refresh();
			was = now;
		});
		client.start();
		this.live.set(shareId, {
			client,
			key: e.key,
			doc: session.doc,
			detach: () => {
				attachment.detach();
				client.stop();
			},
		});
		this.pushTitles();
	}

	private disconnect(shareId: string): void {
		this.live.get(shareId)?.detach();
		this.live.delete(shareId);
	}

	/** The owner's title travels in the shared doc, so members can show it. */
	private pushTitles(): void {
		for (const [id, e] of this.snapshot) {
			const live = this.live.get(id);
			if (!live || !e.owner || !e.noteId) continue;
			const title =
				workspace.getNotes().find((n) => n.id === e.noteId)?.title ?? "";
			const meta = live.doc.getMap<string>("meta");
			if (meta.get("title") !== title) meta.set("title", title);
		}
	}

	/** A member's copy of a shared page, loaded from IndexedDB. */
	openShared(shareId: string): NoteSession {
		const found = this.memberDocs.get(shareId);
		if (found) return found;
		const doc = new Y.Doc();
		const persistence = new IndexeddbPersistence(
			`seijaku-shared-${shareId}`,
			doc,
		);
		const held: MemberDoc = {
			id: shareId,
			doc,
			fragment: doc.getXmlFragment(NOTE_FRAGMENT),
			persistence,
			ready: persistence.whenSynced.then(() => undefined),
		};
		this.memberDocs.set(shareId, held);
		return held;
	}

	/** Remembers a member's last seen title, for the sidebar. */
	rememberTitle(shareId: string, title: string): void {
		const e = this.map.get(shareId);
		if (e && !e.owner && title && e.title !== title)
			this.put(shareId, { title });
	}

	/** Title of a shared page: the owner's note title, or what the owner last sent. */
	titleOf(shareId: string): string {
		const e = this.map.get(shareId);
		if (e?.noteId)
			return workspace.getNotes().find((n) => n.id === e.noteId)?.title ?? "";
		return (
			this.memberDocs.get(shareId)?.doc.getMap<string>("meta").get("title") ??
			e?.title ??
			""
		);
	}

	// --- keeping up with the server -----------------------------------------

	/** Compares this device's list with the server's: new keys after a rotation, lost access, role changes. */
	async refresh(): Promise<void> {
		if (authStore.getState().phase !== "signed-in" || !this.snapshot.length)
			return;
		let remote: {
			id: string;
			memberId: string;
			role: Role;
			epoch: number;
			wrappedKey: string | null;
		}[];
		try {
			const res = await call<typeof remote>("GET", "/api/shared");
			if (!res.ok || !res.data) return;
			remote = res.data;
		} catch {
			return; // offline: try again later
		}
		const byId = new Map(remote.map((r) => [r.id, r]));
		const pair = workspace.index
			.getMap<{ secret: string }>("collabKey")
			.get("pair");
		for (const [id, e] of this.snapshot) {
			if (e.ended) continue;
			const r = byId.get(id);
			if (!r) {
				this.put(id, { ended: true, rotating: false });
				continue;
			}
			const patch: Partial<CollabEntry> = {};
			if (r.role !== e.role && !e.owner) patch.role = r.role;
			if (r.memberId !== e.memberId) patch.memberId = r.memberId;
			if (r.epoch > e.epoch && !e.owner && r.wrappedKey && pair) {
				try {
					patch.key = toBase64(
						unwrapKeyWith(fromBase64(pair.secret), fromBase64(r.wrappedKey)),
					);
					patch.epoch = r.epoch;
				} catch {
					// Not for this key pair (another device made a different one): leave it.
				}
			}
			if (Object.keys(patch).length) this.put(id, patch);
			if (e.owner && e.rotating) void this.rotate(id).catch(() => undefined);
		}
	}

	// --- owner actions ------------------------------------------------------

	/** Turns a page into a shared page (once); returns its id. */
	async share(noteId: string): Promise<string> {
		const have = this.entryForNote(noteId);
		if (have) return have[0];
		await this.keyPair();
		const res = await call<{ id: string; epoch: number }>(
			"POST",
			"/api/shared",
		);
		if (!res.ok || !res.data) throw new Error(String(res.status));
		this.map.set(res.data.id, {
			key: toBase64(newWorkspaceKey()),
			role: "owner",
			epoch: 0,
			owner: true,
			noteId,
			since: Date.now(),
		});
		return res.data.id;
	}

	async people(
		shareId: string,
	): Promise<{ people: Person[]; invites: Invite[] }> {
		const [m, i] = await Promise.all([
			call<Person[]>("GET", `/api/shared/${shareId}/members`),
			call<Invite[]>("GET", `/api/shared/${shareId}/invites`),
		]);
		if (!m.ok) throw new Error(String(m.status));
		return { people: m.data ?? [], invites: i.data ?? [] };
	}

	/** Makes a one-use link. The page key rides inside it, sealed under a secret in the #fragment. */
	async invite(
		shareId: string,
		role: "editor" | "reader",
		label: string,
	): Promise<string> {
		const e = this.entry(shareId);
		if (!e) throw new Error("not shared");
		const secret = newWorkspaceKey();
		const wrapped = toBase64(sealInvite(secret, fromBase64(e.key)));
		const res = await call<{ id: string }>(
			"POST",
			`/api/shared/${shareId}/invites`,
			{
				role,
				label,
				wrapped,
			},
		);
		if (!res.ok || !res.data) throw new Error(String(res.status));
		return `${location.origin}/invite/${res.data.id}#${toBase64(secret)}`;
	}

	async cancelInvite(shareId: string, inviteId: string): Promise<void> {
		await call("DELETE", `/api/shared/${shareId}/invites/${inviteId}`);
	}

	async setRole(
		shareId: string,
		memberId: string,
		role: "editor" | "reader",
	): Promise<void> {
		const res = await call(
			"PATCH",
			`/api/shared/${shareId}/members/${memberId}`,
			{ role },
		);
		if (!res.ok) throw new Error(String(res.status));
	}

	/** Removes someone, then moves everyone else to a new page key. */
	async remove(shareId: string, memberId: string): Promise<void> {
		this.put(shareId, { rotating: true }); // resumes if this device closes or goes offline now
		const res = await call(
			"DELETE",
			`/api/shared/${shareId}/members/${memberId}`,
		);
		if (!res.ok) {
			this.put(shareId, { rotating: false });
			throw new Error(String(res.status));
		}
		await this.rotate(shareId);
	}

	/** New page key for the people left. Safe to repeat. */
	async rotate(shareId: string): Promise<void> {
		const e = this.entry(shareId);
		if (!e?.owner) return;
		const { people } = await this.people(shareId);
		const key = newWorkspaceKey();
		const wraps = people
			.filter((p) => p.role !== "owner")
			.map((p) => ({
				memberId: p.memberId,
				wrapped: p.publicKey
					? toBase64(wrapKeyFor(fromBase64(p.publicKey), key))
					: "",
			}));
		if (wraps.some((w) => !w.wrapped)) throw new Error("a member has no key");
		const res = await call<{ epoch: number }>(
			"POST",
			`/api/shared/${shareId}/rotate`,
			{ wraps },
		);
		if (!res.ok || !res.data) throw new Error(String(res.status));
		this.put(shareId, {
			key: toBase64(key),
			epoch: res.data.epoch,
			rotating: false,
		});
	}

	/** The owner stops sharing: the shared page goes away for everyone. */
	async stop(shareId: string): Promise<void> {
		const res = await call("DELETE", `/api/shared/${shareId}`);
		if (!res.ok && res.status !== 404) throw new Error(String(res.status));
		this.disconnect(shareId);
		this.map.delete(shareId);
	}

	// --- member actions -----------------------------------------------------

	/** Reads an invite link: what it offers, or null if it is used up, expired or its secret is wrong. */
	async peek(
		inviteId: string,
		secret: string,
	): Promise<{
		shareId: string;
		role: Role;
		label: string;
		key: string;
	} | null> {
		const res = await call<{
			shareId: string;
			role: Role;
			label: string;
			wrapped: string;
		}>("GET", `/api/invites/${inviteId}`);
		if (!res.ok || !res.data) return null;
		try {
			const key = toBase64(
				openInvite(fromBase64(secret), fromBase64(res.data.wrapped)),
			);
			return {
				shareId: res.data.shareId,
				role: res.data.role,
				label: res.data.label,
				key,
			};
		} catch {
			return null;
		}
	}

	async join(
		inviteId: string,
		offer: { shareId: string; role: Role; key: string },
	): Promise<void> {
		const pair = await this.keyPair();
		const res = await call<{ epoch: number }>(
			"POST",
			`/api/invites/${inviteId}/claim`,
			{
				publicKey: toBase64(pair.publicKey),
			},
		);
		if (res.status === 409) {
			if (this.entry(offer.shareId)) return; // already in
			throw new Error("member");
		}
		if (!res.ok || !res.data) throw new Error(String(res.status));
		this.map.set(offer.shareId, {
			key: offer.key,
			role: offer.role,
			epoch: res.data.epoch,
			owner: false,
			since: Date.now(),
		});
		void this.refresh();
	}

	/** A member leaves; the local copy goes with them. */
	async leave(shareId: string): Promise<void> {
		const e = this.entry(shareId);
		if (e?.memberId && !e.ended)
			await call("DELETE", `/api/shared/${shareId}/members/${e.memberId}`);
		this.forget(shareId);
	}

	/** Drops a shared page this account no longer has: its entry and its local copy. */
	forget(shareId: string): void {
		this.disconnect(shareId);
		this.map.delete(shareId);
		const held = this.memberDocs.get(shareId);
		this.memberDocs.delete(shareId);
		if (held) void held.persistence.clearData().then(() => held.doc.destroy());
	}
}

export const collab = new Collab();
