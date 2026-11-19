# Seijaku 静寂

**Active calm. The opposite of noise.**

Seijaku is a local-first note-taking app. The name is the Japanese Zen garden idea of stillness: rich and powerful like Notion or Obsidian, with an interface that never shouts.

> **Status:** all eleven phases are built: local editor, sync, end-to-end encrypted accounts, attachments, search, history and sharing, importers, an installable PWA, a Windows/macOS/Linux desktop app, and both deploy paths. A real Cloudflare deploy, an iPhone install and the macOS/Linux builds still need running on real accounts and devices. See [docs/PLAN.md](docs/PLAN.md).

## What works today

- Nested pages with drag-and-drop reorder (and a row menu for keyboard and touch), tags, daily notes, on-device search, a quick switcher, trash with auto-empty
- Block editor with Markdown shortcuts and a slash menu: headings, lists, to-dos, quotes, code, tables, toggles, callouts, math, images, video, audio, files and link previews
- Everything stored on your device first, so it works offline, then synced to your server; notes are end-to-end encrypted, so the server only holds sealed data
- Accounts with a passkey or a 12-word phrase, each with its own workspace; sign-in is optional
- Version history, revocable public share links, Markdown export, and importers for Obsidian, Notion, Keep, Evernote, Apple Notes and Journal, Markdown, HTML and text
- An installable PWA (works offline, iPhone Home Screen) and a desktop app with a global quick-capture hotkey and a tray icon
- "Washi & ink" design: warm paper light theme, sumi-ink dark theme, following the system setting

## Where it is going

One person, many devices: web, an installable PWA on iPhone, and desktop for Windows, macOS and Linux through Tauri 2. Notes are Yjs documents that merge cleanly after editing offline. The server runs either on Cloudflare (Workers, Durable Objects, D1, R2) or self-hosted on Bun, from one codebase.

## Roadmap

Each phase ends in something runnable, and work stops after every phase for review. Details are in [docs/PLAN.md](docs/PLAN.md).

### Phase 1: Scaffold (done)

- [x] Check installed tools, `git init`
- [x] Bun workspaces, TypeScript, Biome, test setup
- [x] Empty apps and packages

### Phase 2: Local editor (done)

- [x] BlockNote restyling spike
- [x] App shell and Washi & ink theme (light and dark)
- [x] Index doc and note tree: nested pages, reorder, trash
- [x] Editor bound to a Y.Doc with the v1 blocks (callout, math, tables, toggles, code, media by URL)
- [x] IndexedDB persistence, works offline on one device

### Phase 3: Sync (done)

- [x] `UpdateStore` interface (append update, load doc, compact)
- [x] `Room` class and message encoding on `y-protocols`: state-vector diff on connect, then live updates, many docs multiplexed by docId
- [x] Update log compaction into one merged update
- [x] Bun adapter: in-process room, `Bun.serve` WebSocket, `UpdateStore` on `bun:sqlite`
- [x] Client provider in `apps/web` store: one WebSocket per device, reconnect with backoff
- [x] Background catch-up of notes that are not open
- [x] Cloudflare adapter: `WorkspaceRoom` Durable Object with WebSocket hibernation, `UpdateStore` on DO SQLite
- [x] Sync status in the title bar, per the design (Synced, Syncing, Offline, Keep your notes safe), and the word count and "Saved on this device" footer
- [x] `bun test`: two simulated clients converge, offline edits merge, compaction keeps state; the Bun server is tested over a real socket and restart (the DO store is checked with `apps/server/scripts/smoke.ts` against `wrangler dev`, not in `bun test`)
- [x] Two browser profiles see each other's edits and offline edits merge after reconnect (checked by hand in the browser pane, not Playwright)
- [x] Reload offline still opens notes (service worker, phase 9)
- [x] Playwright automation of the two-context test (`bun run test:e2e`)

### Phase 4: Auth (done)

- [x] Spike Better Auth passkeys on both runtimes (fallback: `@simplewebauthn` with own sessions)
- [x] First-run setup gated by `SETUP_TOKEN`, then registration closes
- [x] Passkey and recovery-phrase sign-in, end-to-end encryption
- [x] Session checks on HTTP and WebSocket upgrade

### Accounts rework (done)

Sign-in is optional and accounts work like a wallet.

- [x] Move the default dev server port off 8787 (to 8791)
- [x] Use the app without an account; signing in turns sync on and uploads local notes
- [x] Anyone can create an account with a passkey or a 12-word phrase; one encrypted workspace per account
- [x] `SETUP_TOKEN` becomes an optional sign-up code
- [x] A passkey alone opens notes on a new device (WebAuthn PRF), with the phrase as fallback
- [x] One-container self-host: Bun serves the web build, Dockerfile and compose

### Phase 5: Attachments

- [x] `BlobStore` adapters: R2 and local disk
- [x] Upload and download for images and files (sealed on the device, addressed by their hash)
- [x] Offline cache and an upload queue that flushes on reconnect
- [x] Link-preview unfurl endpoint and a Link preview block

### Phase 6: Organising

- [x] Tags
- [x] Daily notes (`daily-YYYY-MM-DD`)
- [x] On-device search (own implementation, no MiniSearch)
- [x] Ctrl/Cmd+K quick switcher
- [x] Trash: permanent delete and auto-empty
- [x] Markdown import and export, whole-workspace zip

### Phase 7: History and sharing

- [x] Version snapshots on the server and a history panel (sealed on the device)
- [x] Restore as a new edit
- [x] Public read-only share links (`/share/:token#key`), revocable

### Phase 8: Importers

- [x] Common intermediate form and shared writer
- [x] Obsidian, Notion, Google Keep, Evernote
- [x] Apple Notes and Apple Journal (read as folders of HTML/Markdown/text; real export formats still unconfirmed)
- [x] Generic Markdown, HTML and plain text

### Phase 9: PWA (done)

- [x] Service worker app-shell caching, so the app loads offline
- [x] Manifest and icons
- [x] iPhone polish: safe areas, keyboard handling (the floating formatting bar)
- [x] Code-split the main bundle
- [ ] Installing and editing offline on a real iPhone (needs a device)

### Phase 10: Desktop (done)

- [x] Tauri 2 shell for Windows, macOS and Linux (built and run on Windows; macOS and Linux build in CI)
- [x] Sign-in through the system browser and a `seijaku://` deep link
- [x] Server URL setting
- [x] Quick capture: global hotkey and tray
- [x] Auto-updater and GitHub Actions builds
- [ ] A release tag and the `TAURI_SIGNING_PRIVATE_KEY` secret, to produce the first signed update

### Phase 11: Deploy (done)

- [x] `wrangler.jsonc` and D1 migrations for Cloudflare (checked on `wrangler dev` and `wrangler deploy --dry-run`)
- [x] Dockerfile and compose for self-hosting
- [x] Deployment docs for both paths
- [ ] A real Cloudflare deploy and a `docker compose up` (need your account and a Docker host)

Hosting, in order of priority: self-hosted Bun in one container (a VPS, Railway, Fly, Render or anything that runs Docker with a volume), then Cloudflare. Static-only hosts such as Vercel cannot run the server, because it needs a long-lived WebSocket and a SQLite file.

## Deploy

**Self-host (one container).** Bun serves the API, the sync socket and the web app, with notes and files on a volume:

```bash
SEIJAKU_ORIGIN=https://notes.example.com docker compose up -d
```

Set `SEIJAKU_ORIGIN` to the public address (passkeys need HTTPS and that exact origin). Set `SETUP_TOKEN` to make every new account enter a sign-up code; unset, anyone who can reach the server can create an account. The same Dockerfile works on a VPS, Railway, Fly and Render; give it a volume at `/data`.

**Cloudflare.** Log in with `wrangler login`, create the database and bucket once, then deploy:

```bash
cd apps/server
bunx wrangler d1 create seijaku          # put the printed database_id into wrangler.jsonc
bunx wrangler r2 bucket create seijaku-files
cd ../.. && bun run --cwd apps/web build
bun run --cwd apps/server deploy
```

The Worker also serves the web app and keeps one Durable Object per account. Account tables are created in D1 by the Worker itself on its first request, so there is no separate migration step. Passkeys need HTTPS and a stable address; the Worker uses the address it is opened at, or `SEIJAKU_ORIGIN` under `vars` in `wrangler.jsonc` (comma-separated) if you serve it from several. Optionally `bunx wrangler secret put SETUP_TOKEN` for a sign-up code. `bun run --cwd apps/server dev:worker` runs the same thing locally on workerd.

Static-only hosts such as Vercel cannot run the server: it needs a long-lived WebSocket and a SQLite file.

**Desktop app.** Pushing a tag like `v0.1.0` builds Windows, macOS and Linux installers on GitHub Actions into a draft release. Add the updater key (the private half of the key whose public half is in `apps/desktop/src-tauri/tauri.conf.json`) as the repository secret `TAURI_SIGNING_PRIVATE_KEY`. In the app, set the server address under Settings, Sync, then sign in.

## Getting started

You need [Bun](https://bun.sh).

```bash
bun install
bun run --cwd apps/web dev
```

Open http://localhost:5173.

For sync and sign-in, run the server beside it:

```bash
bun run --cwd apps/server dev
```

It listens on port 8791, and Vite proxies `/api` and `/sync` to that port. If the app says it "cannot reach the server", check that another program is not already using 8791. If one is, start the server with `PORT=<other>` and change the two proxy targets in `apps/web/vite.config.ts` to match.

### Commands

```bash
bun run typecheck           # tsc --noEmit in every package
bun run lint                # biome check
bun run format              # biome format --write
bun test                    # all tests
bun run test:e2e            # Playwright: two devices, offline merge (needs Chrome)
bun run --cwd apps/web build
```

## Repository layout

```
apps/web        Vite + React SPA (TanStack Router, Tailwind v4, BlockNote)
apps/desktop    Tauri 2 shell (Rust): tray, capture hotkey, keychain, updater
apps/server     Hono server, Cloudflare and Bun entry points
packages/db     Drizzle schema and migrations (sync log, key wraps, history, shares)
packages/sync   Yjs workspace model and sync protocol
docs/PLAN.md    Scope, architecture and phase plan
```

## Tech

Bun workspaces, TypeScript, React, Vite, Tailwind CSS v4, BlockNote (core, MPL packages only), Yjs with y-indexeddb, TanStack Router, Biome.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
