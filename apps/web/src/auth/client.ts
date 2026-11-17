import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/client";
import { apiUrl } from "../workspace/syncUrl";

/** Better Auth's client, pointed at the server this device syncs with. */
export function authClient() {
	return createAuthClient({
		baseURL: apiUrl("") || location.origin,
		plugins: [passkeyClient()],
		fetchOptions: { credentials: "include" },
	});
}
