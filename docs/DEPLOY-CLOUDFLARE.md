# Deploy on Cloudflare and Neon

Put your own Seijaku online with free accounts and no domain. For one container on your own machine, see [DEPLOY-SELF-HOST.md](DEPLOY-SELF-HOST.md).

> **Not built yet.** Neon support is planned in [DEPLOY-PLAN.md](DEPLOY-PLAN.md), and steps 2 to 8 describe that design. They have not been run. The current code uses Cloudflare D1: follow [Today: Cloudflare with D1](#today-cloudflare-with-d1).

## What runs where

| Part                                     | Service                                          |
| ---------------------------------------- | ------------------------------------------------ |
| Web app, API, sign-in                    | One Cloudflare Worker (static files included)    |
| Live sync sockets                        | Durable Objects, one per account and shared page |
| Accounts, share links, encrypted changes | Neon Postgres                                    |
| Attached files, history snapshots        | Cloudflare R2                                    |

Notes, titles and files are encrypted on the device. Neither Neon nor Cloudflare can read them.

## Free limits (checked 2026-11-23)

| Service         | Free allowance                                       | When it runs out                                                 |
| --------------- | ---------------------------------------------------- | ---------------------------------------------------------------- |
| Workers         | 10 ms CPU per request, a daily request limit         | Requests fail until the daily reset (00:00 UTC)                  |
| Durable Objects | SQLite-backed objects, daily limits                  | Sync stops until the reset                                       |
| Neon            | 100 CU-hours, 1 GB storage, 5 GB transfer a month    | Sign-in, files and sync stop; notes keep working on every device |
| R2              | 10 GB, 1 million writes and 10 million reads a month | **You are charged.** Cloudflare may ask for a card to turn R2 on |

Neon sleeps after 5 idle minutes, so the next request is slower. A free project unused for 90 days may be deleted. Check the current terms: [Neon](https://neon.com/faqs/free-plan-limits-and-quotas), [R2](https://developers.cloudflare.com/r2/pricing/), [Workers](https://developers.cloudflare.com/workers/platform/limits/).

## 1. Before you start

You need a Cloudflare account, a Neon account, [Bun](https://bun.sh) and Git.

```bash
git clone https://github.com/<you>/seijaku.git   # your fork
cd seijaku
bun install
```

In the Cloudflare dashboard, turn on R2 and choose your `workers.dev` subdomain (Workers & Pages). Your address will be `https://seijaku.<subdomain>.workers.dev`.

**Choose it carefully.** Passkeys belong to one address and cannot be moved to another.

## 2. Create the database

In the [Neon console](https://console.neon.tech) create a project named `seijaku`:

- **Region:** the one nearest your users. It cannot be changed, and every saved edit travels there.
- **Compute size:** set the maximum to 0.25 CU. The free hours then last about 400 active hours a month.

Copy the connection string into a file named `.env` in the repository root. Git ignores it.

```
DATABASE_URL=postgresql://...
```

Create the tables:

```bash
bun apps/server/scripts/migrate-neon.ts
```

## 3. Create the file bucket

```bash
cd apps/server
bunx wrangler login
bunx wrangler r2 bucket create seijaku-files
```

Add `--location apac` (or `weur`, `eeur`, `wnam`, `enam`) to place it near your users. If you use another bucket name, change `bucket_name` in `wrangler.jsonc`.

## 4. Set your address

In `apps/server/wrangler.jsonc`:

```jsonc
"vars": { "SEIJAKU_ORIGIN": "https://seijaku.<subdomain>.workers.dev" }
```

## 5. Store the secrets

Make a random secret and save it in a password manager. If you lose it, recovery phrases stop working for sign-in.

```bash
bun -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Each command below asks for the value. Paste it there, never into a file you commit.

```bash
bunx wrangler secret put AUTH_SECRET
bunx wrangler secret put DATABASE_URL
```

Optional: require a code for new accounts. Without it, **anyone who finds your address can sign up** and use your free limits.

```bash
bunx wrangler secret put SETUP_TOKEN
```

## 6. Deploy

From the repository root:

```bash
bun run --cwd apps/web build
bun run --cwd apps/server deploy
```

## 7. Check it

1. Open `https://seijaku.<subdomain>.workers.dev/api/health`. It answers `{"ok":true}`.
2. Create an account and write down the 12-word phrase. Nobody can recover it for you.
3. Sign in from a second device with the phrase. A note written on one appears on the other.
4. Attach an image and open it on the other device.

## 8. Deploy automatically (optional)

In your GitHub repository, under Settings, Secrets and variables, Actions, add:

| Secret                  | Where it comes from                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Cloudflare, My Profile, API Tokens, template "Edit Cloudflare Workers", your account only |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard, Workers & Pages                                                     |
| `DATABASE_URL`          | Neon connection string                                                                    |

Each push to `main` that passes the checks migrates the database and deploys.

## Settings

| Name                                                | Kind             | Purpose                                                                                                          |
| --------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                      | secret, required | Neon connection string                                                                                           |
| `AUTH_SECRET`                                       | secret, required | Signs sessions, at least 32 characters                                                                           |
| `SEIJAKU_ORIGIN`                                    | var, required    | Address(es) people open, comma-separated; the first is the main one                                              |
| `SETUP_TOKEN`                                       | secret           | Sign-up code                                                                                                     |
| `SEIJAKU_RP_ID`                                     | var              | Passkey domain, if it must differ from the address                                                               |
| `QUOTA_FILES_MB`, `QUOTA_SNAPSHOTS`, `QUOTA_SHARES` | var              | Per-account limits (500, 5000, 100). `0` means no limit. Files, snapshots and published pages share the MB limit |
| `QUOTA_SYNC_MB`                                     | var              | Limit on the encrypted sync log per account and per shared page (1024). `0` means no limit                       |

## Update

```bash
git pull
bun install
bun apps/server/scripts/migrate-neon.ts
bun run --cwd apps/web build
bun run --cwd apps/server deploy
```

## Back up

Every signed-in device holds its own notes, and Settings, Data and storage exports them. For the server, dump Neon with `pg_dump` and copy the R2 bucket. Keep `AUTH_SECRET` with the backup. Notes inside stay encrypted, but the dump holds sign-in sessions: store it privately.

## Use your own domain later

Add the domain to the Worker, put it first in `SEIJAKU_ORIGIN` and deploy. Tell people first:

- Open the old address and wait for "Synced". Notes that never synced stay behind in that browser.
- Sign in at the new address with the 12-word phrase, then add a new passkey. Old passkeys do not work there.

## If something goes wrong

| What you see                  | Likely cause                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| Error 1102                    | The request used more than 10 ms CPU. Workers Paid raises the limit                   |
| Passkey refused               | The address differs from `SEIJAKU_ORIGIN`, or the passkey was made at another address |
| Sync stays on "syncing"       | Neon is waking, or its monthly hours are used up (see the Neon console)               |
| "Sign in first" after signing | `SEIJAKU_ORIGIN` does not match the address in the browser                            |
| Anything else                 | `bunx wrangler tail` in `apps/server` shows live errors                               |

## Today: Cloudflare with D1

The current code keeps accounts in D1 and the sync log inside Durable Objects. It needs no Neon account. It has been run locally (`wrangler dev`), never deployed.

```bash
cd apps/server
bunx wrangler login
bunx wrangler d1 create seijaku           # put the printed database_id into wrangler.jsonc
bunx wrangler r2 bucket create seijaku-files
cd ../.. && bun run --cwd apps/web build
bun run --cwd apps/server deploy
```

Tables are created on the first request. Set `SEIJAKU_ORIGIN` under `vars` if you serve several addresses. `SETUP_TOKEN` works as above; `AUTH_SECRET` is made and kept in D1 unless you set it.

There is no tool to move a D1 site to Neon. Devices upload their notes again after signing up anew; accounts, share links and history do not move.
