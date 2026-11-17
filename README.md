# Seijaku 静寂

**Active calm. The opposite of noise.**

Seijaku is a local-first note-taking app. The name is the Japanese Zen garden idea of stillness: rich and powerful like Notion or Obsidian, with an interface that never shouts.

> **Status: early development.** The local editor works in the browser, with no server yet. Sync, sign-in, attachments, search and the desktop app are planned. See [docs/PLAN.md](docs/PLAN.md) for the phases.

## What works today

- Nested pages with drag-and-drop reorder, plus a row menu (up, down, indent, outdent) for keyboard and touch
- Block editor with Markdown shortcuts and a slash menu: headings, lists, to-dos, quotes, code with highlighting, tables, toggles, callouts, math (KaTeX), images, video, audio and files by URL
- Trash with restore
- Everything stored on your device in IndexedDB, so it works offline
- "Washi & ink" design: warm paper light theme, sumi-ink dark theme, following the system setting
- Responsive layout with a drawer on phones

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
- [ ] Reload offline still opens notes: needs the service worker, phase 9
- [ ] Playwright automation of the two-context test

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

- [ ] Common intermediate form and shared writer
- [ ] Obsidian, Notion, Google Keep, Evernote
- [ ] Apple Notes and Apple Journal (confirm export formats first)
- [ ] Generic Markdown, HTML and plain text

### Phase 9: PWA

- [ ] Service worker app-shell caching, so the app loads offline
- [ ] Manifest and icons
- [ ] iPhone polish: safe areas, keyboard handling
- [ ] Code-split the main bundle

### Phase 10: Desktop

- [ ] Tauri 2 shell for Windows, macOS and Linux
- [ ] Sign-in through the system browser and a `seijaku://` deep link
- [ ] Server URL setting
- [ ] Quick capture: global hotkey and tray
- [ ] Auto-updater and GitHub Actions builds

### Phase 11: Deploy

- [ ] `wrangler.jsonc` and D1 migrations for Cloudflare
- [x] Dockerfile and compose for self-hosting
- [x] Deployment docs for both paths

Hosting, in order of priority: self-hosted Bun in one container (a VPS, Railway, Fly, Render or anything that runs Docker with a volume), then Cloudflare. Static-only hosts such as Vercel cannot run the server, because it needs a long-lived WebSocket and a SQLite file.

## Deploy

**Self-host (one container).** Bun serves the API, the sync socket and the web app, with notes and files on a volume:

```bash
SEIJAKU_ORIGIN=https://notes.example.com docker compose up -d
```

Set `SEIJAKU_ORIGIN` to the public address (passkeys need HTTPS and that exact origin). Set `SETUP_TOKEN` to make every new account enter a sign-up code; unset, anyone who can reach the server can create an account. The same Dockerfile works on a VPS, Railway, Fly and Render; give it a volume at `/data`.

**Cloudflare.** Build the web app, then deploy the Worker, which also serves it:

```bash
bun run --cwd apps/web build
bun run --cwd apps/server wrangler deploy
```

Create the D1 database and R2 bucket named in `apps/server/wrangler.jsonc` first, and set `SEIJAKU_ORIGIN` (and optionally the `SETUP_TOKEN` secret).

Static-only hosts such as Vercel cannot run the server: it needs a long-lived WebSocket and a SQLite file.

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
bun run --cwd apps/web build
```

## Repository layout

```
apps/web        Vite + React SPA (TanStack Router, Tailwind v4, BlockNote)
apps/desktop    Tauri 2 shell (placeholder)
apps/server     Hono server, Cloudflare and Bun entry points (placeholder)
packages/db     Drizzle schema and migrations (placeholder)
packages/sync   Yjs workspace model and sync protocol
docs/PLAN.md    Scope, architecture and phase plan
```

## Tech

Bun workspaces, TypeScript, React, Vite, Tailwind CSS v4, BlockNote (core, MPL packages only), Yjs with y-indexeddb, TanStack Router, Biome.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
