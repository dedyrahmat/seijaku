import { isValidPhrase, phraseKeys } from "@seijaku/sync";
import { apiUrl } from "../workspace/syncUrl";
import { authenticatePasskey } from "./keys";
import { authStore } from "./session";

/** Why a deletion did not happen. Nothing was deleted for "wrong-phrase", "not-confirmed" and "offline". */
export class DeleteError extends Error {
	constructor(
		readonly kind: "wrong-phrase" | "not-confirmed" | "offline" | "other",
		message?: string,
	) {
		super(message ?? kind);
	}
}

/**
 * Deletes the account and everything the server holds for it, then signs this device out.
 * Proof is the recovery phrase, or a passkey sign-in made just now (the server accepts a
 * session that fresh). The notes on this device stay until the person chooses to wipe them.
 */
export async function deleteAccount(proof: { phrase?: string }): Promise<void> {
	let loginKey: string | undefined;
	if (proof.phrase !== undefined) {
		if (!isValidPhrase(proof.phrase)) throw new DeleteError("wrong-phrase");
		loginKey = phraseKeys(proof.phrase).loginKey;
	} else {
		try {
			await authenticatePasskey();
		} catch (err) {
			throw new DeleteError(
				"other",
				err instanceof Error ? err.message : undefined,
			);
		}
	}
	let res: Response;
	try {
		res = await fetch(apiUrl("/api/account"), {
			method: "DELETE",
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ loginKey }),
		});
	} catch {
		throw new DeleteError("offline");
	}
	if (res.status === 403)
		throw new DeleteError(loginKey ? "wrong-phrase" : "not-confirmed");
	if (!res.ok) throw new DeleteError("offline");
	await authStore.signOut();
}
