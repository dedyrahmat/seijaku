import { type Cipher, createCipher } from "@seijaku/sync";
import { useSyncExternalStore } from "react";
import { apiUrl } from "../workspace/syncUrl";
import { authClient } from "./client";
import { clearWorkspaceKey, loadWorkspaceKey } from "./keys";

export { authClient };

/**
 * Who is using this device. The app keeps working offline, so a device that was signed in
 * stays "signed in" while the server cannot be reached; only the server saying "no" signs
 * it out. Signed in is not enough on its own: notes are end-to-end encrypted, so the device
 * also needs the workspace key ("locked" until it has one).
 */

export type AuthPhase =
	/** First look, before the key and the server have answered. */
	| "checking"
	/** No account on this device: notes stay here, and signing in turns sync on. */
	| "signed-out"
	/** Signed in, but this device does not hold the workspace key yet. */
	| "locked"
	| "signed-in";

export interface AuthState {
	phase: AuthPhase;
	/** Creating an account needs the server's sign-up code. */
	codeRequired: boolean;
	/** The server could not be reached on the last look. */
	offline: boolean;
}

interface ServerStatus {
	signedIn: boolean;
	codeRequired: boolean;
}

const KNOWN_KEY = "seijaku:signed-in";

function wasSignedIn(): boolean {
	try {
		return localStorage.getItem(KNOWN_KEY) === "1";
	} catch {
		return false;
	}
}

function remember(on: boolean): void {
	try {
		if (on) localStorage.setItem(KNOWN_KEY, "1");
		else localStorage.removeItem(KNOWN_KEY);
	} catch {
		// Storage blocked: the next visit asks the server again.
	}
}

class AuthStore {
	private state: AuthState = {
		phase: "checking",
		codeRequired: false,
		offline: false,
	};
	private listeners = new Set<() => void>();
	private inflight: Promise<void> | null = null;
	private cipher: Cipher | null = null;
	/** Resolves once the key has been looked for on this device. */
	private booted: Promise<void>;
	/** The phrase made during setup, held until the person has said they saved it. */
	private pendingPhrase: string | null = null;

	constructor() {
		this.booted = loadWorkspaceKey().then((key) => {
			this.cipher = key ? createCipher(key) : null;
			// A device that was signed in and holds the key opens straight away, offline or not.
			if (this.cipher && wasSignedIn())
				this.set({ ...this.state, phase: "signed-in" });
		});
	}

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	getState = (): AuthState => this.state;

	/** Seals and opens what sync sends; null until this device holds the workspace key. */
	getCipher = (): Cipher | null => this.cipher;

	private set(next: AuthState): void {
		const a = this.state;
		if (
			a.phase === next.phase &&
			a.codeRequired === next.codeRequired &&
			a.offline === next.offline
		)
			return;
		this.state = next;
		for (const l of this.listeners) l();
	}

	/** Asks the server who this device is. Safe to call often; overlapping calls share one request. */
	refresh(): Promise<void> {
		this.inflight ??= this.look().finally(() => {
			this.inflight = null;
		});
		return this.inflight;
	}

	private async look(): Promise<void> {
		await this.booted;
		let status: ServerStatus;
		try {
			const res = await fetch(apiUrl("/api/auth/seijaku/status"), {
				credentials: "include",
				signal: AbortSignal.timeout(5000),
			});
			if (!res.ok) throw new Error(String(res.status));
			status = (await res.json()) as ServerStatus;
		} catch {
			// No answer: trust what this device already knew.
			this.set({
				...this.state,
				phase: wasSignedIn()
					? this.cipher
						? "signed-in"
						: "locked"
					: "signed-out",
				offline: true,
			});
			return;
		}
		remember(status.signedIn);
		this.set({
			phase: status.signedIn
				? this.cipher
					? "signed-in"
					: "locked"
				: "signed-out",
			codeRequired: status.codeRequired,
			offline: false,
		});
	}

	/** After sign-in, sign-out or unlocking: forget what was cached and look again. */
	async changed(): Promise<void> {
		await this.booted;
		const key = await loadWorkspaceKey();
		this.cipher = key ? createCipher(key) : null;
		await this.refresh();
	}

	async signOut(): Promise<void> {
		try {
			await authClient().signOut();
		} catch {
			// Offline: still leave this device.
		}
		remember(false);
		await clearWorkspaceKey();
		this.cipher = null;
		this.set({ ...this.state, phase: "signed-out" });
		await this.refresh();
	}

	holdPhrase(phrase: string): void {
		this.pendingPhrase = phrase;
	}

	/** The phrase made during setup, until the person has said they saved it. */
	peekPhrase(): string | null {
		return this.pendingPhrase;
	}

	clearPhrase(): void {
		this.pendingPhrase = null;
	}
}

export const authStore = new AuthStore();

export function useAuth(): AuthState {
	return useSyncExternalStore(authStore.subscribe, authStore.getState);
}

/** A readable message for a failed Better Auth call. */
export function authMessage(
	error: { message?: string | undefined } | null | undefined,
	fallback: string,
): string {
	return error?.message?.trim() || fallback;
}
