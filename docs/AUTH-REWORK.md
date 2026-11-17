# Accounts rework: optional sign-in, wallet-style accounts

**Status: accepted on 2026-11-17, not built.** The owner is building this by hand. The code still has the phase 4 behaviour (one owner, `SETUP_TOKEN` required, app locked until signed in). Tick the boxes below as steps land, then fold the result into [PLAN.md](PLAN.md) and delete this file.

## Why

- **Sign-in was required.** `Shell` sends every signed-out device to `/sign-in` or `/setup`, so the app cannot be used without a server.
- **Setup felt like server administration.** Creating the account needs a `SETUP_TOKEN` read from the server's console.
- **The "cannot reach the server" message** on 2026-11-17 was not an auth bug. Another program on this machine (`caveman-proxy.exe`) holds `127.0.0.1:8787`, so Vite proxied `/api` to it and got 404. The Seijaku server never had the port.

## Decisions

| Area                    | Decision                                                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in                 | Optional. Notes live on the device. Signing in turns sync on and uploads every local note.                                                               |
| Accounts                | Anyone can create one, like a wallet: a passkey or a 12-word phrase. Each account has its own encrypted workspace. Replaces "single owner, no sign-ups". |
| `SETUP_TOKEN`           | Optional. Unset: open sign-up. Set: a sign-up code every new account must enter.                                                                         |
| Passkey on a new device | Opens notes by itself when the passkey supports WebAuthn PRF. Otherwise the phrase is asked once on that device.                                         |
| Encryption              | Unchanged. The server stores sealed blobs only (`packages/sync/src/crypto.ts`).                                                                          |
| Hosting                 | Self-host first: one container where Bun serves the API, the sync socket and the web build. Cloudflare stays the second target.                          |

Assumed defaults:

- Signing out keeps the notes on the device. Signing in to another account afterwards uploads them there too.
- Signing in to an existing account from a device that has local notes merges both sets (Yjs merge of the index doc).
- No migration of server data: nothing real was stored. Delete `apps/server/data/` before the first run.
- No per-account storage limit yet. On a public server, set `SETUP_TOKEN`.

## Steps

### 0. Spike: PRF through Better Auth

- [ ] In Chrome with a virtual authenticator (`hasPrf: true`), confirm `prf.results.first` comes back from `signIn.passkey`, and whether it also comes back at registration.

`@better-auth/passkey` 1.7.25 already accepts `extensions` and returns `clientExtensionResults` when called with `returnWebAuthnResponse: true` (see its `dist/client.mjs`). Fallback if the spike fails: keep today's `/unlock` (phrase once per device).

### 1. Dev port

- [x] Move the default server port from 8787 to **8791** in `apps/server/src/bun.ts`, `apps/web/vite.config.ts`, `.claude/launch.json`, `apps/server/scripts/smoke.ts`, `apps/server/wrangler.jsonc` (`dev.port`), `CLAUDE.md` and `README.md`.

This step alone makes today's sign-in and setup reachable again.

### 2. Server: many accounts

`apps/server/src/auth.ts`

- [x] Remove `OWNER_EMAIL`, `isClaimed`, `claimOwner` and the one-user `databaseHooks`.
- [x] Add `newAccount(ctx, config, token)`: checks the token only when `config.setupToken` is set, then creates a user with a random `…@seijaku.local` email.
- [x] Rename `/seijaku/claim` to `/seijaku/sign-up` (same body, token optional). The passkey plugin's `resolveUser` calls `newAccount`.
- [x] `/seijaku/status` returns `{ signedIn, codeRequired }`.
- [x] `AuthService.signedIn(headers)` becomes `userId(headers): Promise<string | null>`.
- [x] Keep the rate limits on sign-up and passkey registration.

`/seijaku/phrase` and `/key-wraps` are already per user and stay as they are. Known gap: an abandoned passkey registration leaves an empty user row.

Storage and rooms

- [x] `apps/server/src/sql-store.ts`: optional `scope` constructor argument, prefixed to `doc_id`. Remove the old `DROP TABLE doc_updates` line.
- [x] `apps/server/src/bun.ts`: a `Map<userId, Room>`, each over `new SqlUpdateStore(driver, userId)`; the socket's `data` carries the user id. Stop inventing a setup token at start; log whether sign-up is open or needs the code.
- [x] `apps/server/src/worker.ts`: `idFromName(userId)` instead of `"default"`. Each Durable Object has its own SQLite, so it needs no scope.
- [x] `apps/server/src/app.ts`: the `/api/files` guard uses `userId`. File ownership waits for phase 5 (ids are random and contents sealed).

### 3. Client: sign-in is optional

- [x] `apps/web/src/auth/session.ts`: drop the `unclaimed` phase; state gains `codeRequired`. `checking` blocks nothing.
- [x] `apps/web/src/pages/Shell.tsx`: remove the signed-out redirects and render the app in every phase. Keep only `locked` → `/unlock`.
- [x] `apps/web/src/workspace/store.ts`: `applyAuth` already starts sync only when signed in, and catch-up uploads every note in the index. Verify; no change expected.
- [x] `packages/sync/src/client.ts`: save the doc's `remoteId` inside `DocSyncState`. On subscribe, if the saved one differs from the current one (another account or key), reset `lastSeq` and `remoteSV`. Without this, switching accounts skips uploads.
- [x] `apps/web/src/components/SyncStatus.tsx`: new kind `local` when signed out, "On this device only", with a "Sign in to sync" link.
- [x] `apps/web/src/pages/AuthPages.tsx`: Setup becomes "Create your account" (passkey or phrase; the code field shows only when `codeRequired`). Sign-in's link becomes "New here? Create an account". Both pages get "Keep writing without an account" back to `/`. The recovery page is unchanged.
- [x] `apps/web/src/pages/SettingsPage.tsx` and `components/AccountSettings.tsx`: when signed out, the account rows are replaced by one row with Create account and Sign in.
- [x] `apps/web/src/editor/Editor.tsx`: the signed-out upload error reads "Sign in to add files".

Read the mockup boards Sign-In, Setup, Recovery, Sync-States and Settings before changing these screens, and compare afterwards.

### 4. Passkey opens notes (PRF)

- [ ] `packages/sync`: `prfWrapKey(output)`, an HKDF of the PRF output, reusing `derive` in `crypto.ts`.
- [ ] `apps/web/src/auth/keys.ts`: one helper that runs `signIn.passkey` / `addPasskey` with `extensions.prf.eval.first` set to a fixed salt and `returnWebAuthnResponse: true`.
- [ ] Device holds the key and gets a PRF result: `POST /key-wraps` with `{ kind: "passkey", ref: credentialId, wrapped }` (the endpoint exists).
- [ ] Device has no key: find the wrap by credential id in `GET /key-wraps`, unwrap, save. No result or no wrap: `/unlock` with the phrase.

Use the helper from sign-up, sign-in and Settings → Add passkey.

### 5. Deploy

- [ ] `apps/server/src/bun.ts`: when the Hono app answers 404 to a GET, serve the file from `SEIJAKU_WEB` (default `../web/dist`), else `index.html`.
- [ ] `Dockerfile` at the root: `oven/bun`, install, `bun run --cwd apps/web build`, start `apps/server/src/bun.ts` on `0.0.0.0`, volume `/data` (`SEIJAKU_DB`, `SEIJAKU_BLOBS`).
- [ ] `docker-compose.yml`: that image, the volume, `SEIJAKU_ORIGIN`, optional `SETUP_TOKEN`.
- [ ] `apps/server/wrangler.jsonc`: `assets` pointing at `../web/dist`, single-page fallback, worker first for `/api/*` and `/sync`.
- [ ] `README.md`: VPS, Railway, Fly and Render use the Dockerfile; Cloudflare uses `wrangler deploy`.

Vercel and other static-only hosts cannot run the server: it needs a long-lived WebSocket and a SQLite file. Passkeys need HTTPS and `SEIJAKU_ORIGIN` set to the public address.

### 6. Tests and docs

- [x] `apps/server/src/auth.test.ts`: two accounts sign up; each phrase opens only its own wrap; the code is required when `SETUP_TOKEN` is set and not otherwise; rate limit.
- [x] `apps/server/src/bun.test.ts`: two users on one server never receive each other's entries.
- [x] `packages/sync/src/sync.test.ts`: saved state from another key is ignored and the doc is uploaded in full.
- [ ] Fold this file into `PLAN.md` and update `CLAUDE.md` and `README.md` to the new behaviour.

## Verification

1. `bun run typecheck`, `bun run lint`, `bun test`.
2. Start `server` and `web`; `http://localhost:5173/api/auth/seijaku/status` answers with JSON.
3. On `localhost`: write notes signed out (status says "On this device only"). Create an account with a phrase; status goes to Synced.
4. On `[::1]`: sign in with that phrase; the notes appear.
5. In a new browser profile: create a second account; it sees none of the first account's notes.
6. Virtual authenticator with PRF: create a passkey account, then sign in on the other origin with the passkey alone. Repeat with PRF off: it asks for the phrase.
7. Restart the server with `SETUP_TOKEN=x`: sign-up asks for the code and refuses a wrong one.
8. `bun run --cwd apps/web build`, run the server alone and open its port: the app loads and syncs. Then `docker build`, and `wrangler dev` for the Worker.
