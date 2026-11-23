# Deploy plan: Cloudflare Worker, R2 and Neon

The working plan for the first live deploy. Tick items here as they are done. How-to guides: [DEPLOY-CLOUDFLARE.md](DEPLOY-CLOUDFLARE.md) and [DEPLOY-SELF-HOST.md](DEPLOY-SELF-HOST.md).

**Status (2026-11-23):** approved. No code written, nothing installed, nothing deployed. Next: step 1.

## Decisions

| Topic    | Decision                                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------- |
| Database | Everything on Neon: account tables and the sync log. Region Singapore (`aws-ap-southeast-1`), which cannot be changed |
| Files    | Cloudflare R2, bucket `seijaku-files` (`r2-blobs.ts` exists)                                                          |
| Backend  | Cloudflare Worker. Durable Objects stay, only to hold live sync sockets; they store no notes                          |
| Frontend | Served by the same Worker at `https://seijaku.<subdomain>.workers.dev`                                                |
| Sign-up  | Open, 500 MB of files per account                                                                                     |
| Docker   | Keeps SQLite, so there are two schemas (SQLite and Postgres)                                                          |
| Deploys  | First from the owner's PC, then GitHub Actions on push to `main`                                                      |
| Code     | Branch `neon-deploy` and a pull request                                                                               |

Frontend hosts considered: **same Worker** (chosen: one address, free static files, already configured); **Cloudflare Pages** with a proxy function (two deploys, proxied calls use Worker requests); **Vercel or Netlify** (the app expects one address for cookies, passkeys and the socket, and WebSocket forwarding to another host is unconfirmed).

## What the owner does

Keys are never pasted into a chat. Sign-ins happen in the browser; secrets are typed into the command that stores them.

- [ ] Sign in to Neon (`neon login`) and Cloudflare (`wrangler login`)
- [ ] Turn on R2 in the dashboard (add a card or PayPal if asked)
- [ ] Choose the `workers.dev` subdomain. Passkeys are tied to this address
- [ ] Store `DATABASE_URL` and `AUTH_SECRET` as Worker secrets; keep `AUTH_SECRET` in a password manager
- [ ] Say yes to the first deploy
- [ ] Create a Cloudflare API token; add the GitHub secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DATABASE_URL`
- [ ] Test a passkey on a phone, then merge the pull request

## Steps

### 1. Accounts and tools

- [ ] Neon setup (<https://neon.com/prompts/agent-setup.md>): CLI, sign-in, agent plugin. Changes global npm packages and the agent's setup
- [ ] `wrangler login`
- [ ] Neon project `seijaku`, compute capped at 0.25 CU (100 free CU-hours last about 400 active hours), plus a `dev` branch
- [ ] R2 bucket with an APAC location hint

### 2. Spike (stop and report if it fails)

- [ ] Better Auth 1.7 over Neon HTTP with `transaction` off: `kysely-neon`, or Kysely's `PostgresDialect` with a small pool wrapper over `neon()` if its Kysely range excludes 0.29
- [ ] Drizzle rc.5 `neon-http`: timestamps as `Date`, `bytea` round trip, an 8 MB entry
- [ ] `wrangler deploy --dry-run`: bundle size against the free limit

HTTP and not a Pool: a Worker cannot reuse a socket across requests, and the auth service is cached per isolate.

### 3. Code

- [ ] `packages/sync/src/room.ts`, **data safety, do first**: a failed append is logged and never acked, and the client matches acks in order, so the next ack marks the lost edit as saved. Close the socket (1011) when the store fails; the client reconnects and uploads what is missing. Test a store that fails once and a subscribe that fails
- [ ] `packages/db`: `schema/pg.ts`, `drizzle.pg.config.ts` with its own folder, `db:generate`. The log's primary key is `(scope, doc_id, seq)`, so a crafted snapshot frame cannot overwrite another account's row. A test checks both schemas have the same tables and columns
- [ ] `apps/server/src/neon.ts`: Drizzle db, Better Auth dialect and Postgres tables; the only cast to `AccountDb`
- [ ] `apps/server/src/pg-store.ts`: `PgUpdateStore`; `replaceUpTo` is one atomic statement
- [ ] `auth.ts`, `app.ts`, `history.ts`, `account.ts`, `shared.ts`: tables come from `auth.tables`; migrating on start becomes optional (Bun keeps it)
- [ ] `apps/server/scripts/migrate-neon.ts`: Drizzle migrations, then Better Auth's. Run before each deploy
- [ ] `worker.ts`: drop D1; require `DATABASE_URL`, `AUTH_SECRET`, `SEIJAKU_ORIGIN`; set the room and `x-share-*` headers itself and drop any a client sent
- [ ] `room-do.ts`: use `PgUpdateStore`; keep the scope in each socket's attachment so it survives hibernation
- [ ] `BlobStore.delete` takes a list, so deleting a large account fits the per-request call limit
- [ ] `wrangler.jsonc`: no D1, add `/sync/*` to `run_worker_first` (shared pages' sockets are missing today), `preview_urls: false`, `SEIJAKU_ORIGIN`, observability
- [ ] `app.ts` CORS: add `PATCH` (the desktop app cannot change a member's role without it)
- [ ] `collab.ts`: `POLL_MS` from 20 s to 10 min, or one open tab with shared pages keeps Neon awake

### 4. Database and secrets

- [ ] Migrate Neon production; owner stores the two secrets

### 5. First deploy

- [ ] After the owner's yes: build, `wrangler deploy` from the branch, verify

### 6. Automatic deploys

- [ ] `deploy` job in `.github/workflows/ci.yml` after `check`, push to `main` only, one at a time: migrate, build, deploy. Migrations must be additive, because the old Worker runs until the new one is live
- [ ] Remove the "not built yet" notes from the Cloudflare guide; update `README.md`, `CLAUDE.md`, `PLAN.md`; open the pull request

## Verification

- [ ] `bun run typecheck`, `bun run lint`, `bun test`, `bun run test:e2e`
- [ ] Postgres tests on PGlite: store contract, accounts, history, shares, shared-page roles, account deletion, two scopes that cannot touch each other
- [ ] `wrangler dev` on the Neon `dev` branch: `scripts/smoke.ts`, two devices, reconnect after hibernation
- [ ] Live: `/api/health`; phrase and passkey sign-up; two-device sync; upload and reopen a file; public link; shared page as editor and reader; delete the test accounts and confirm Neon and R2 are clean
- [ ] Worker logs show no error 1102 (the free plan's 10 ms CPU limit). Otherwise ask the owner about Workers Paid ($5 a month)

## Accepted risks

- **Neon's free limits** (100 CU-hours, 1 GB, 5 GB transfer a month). When they run out, sign-in, files and sync stop; notes keep working on each device and upload later.
- **Open sign-up with unlimited notes.** The sync log has no per-account limit, so one abuser could fill the 1 GB. Setting `SETUP_TOKEN` closes sign-up without a code change. R2 charges above 10 GB.
- **Slow first request** after 5 idle minutes. Neon may delete a free project unused for 90 days.
- **Own domain later:** passkeys made on `workers.dev` will not work there. People sign in with their phrase and add a new passkey; notes never synced stay behind at the old address.
- **Unconfirmed:** whether R2 asks for a card, `kysely-neon` with Kysely 0.29, the CPU limit.

Not included: custom domain, per-account note quota, staging site, batching keystrokes before saving (add if saving lags), desktop release.
