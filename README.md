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

### Phase 3: Sync

- [ ] `UpdateStore` interface (append update, load doc, compact)
- [ ] `Room` class and message encoding on `y-protocols`: state-vector diff on connect, then live updates, many docs multiplexed by docId
- [ ] Update log compaction into snapshots
- [ ] Bun adapter: in-process room, `Bun.serve` WebSocket, `UpdateStore` on `bun:sqlite`
- [ ] Client provider in `apps/web` store: one WebSocket per device, reconnect with backoff
- [ ] Background catch-up of notes that are not open
- [ ] Cloudflare adapter: `WorkspaceRoom` Durable Object with WebSocket hibernation, `UpdateStore` on DO SQLite
- [ ] `bun test`: two simulated clients converge, offline edits merge, compaction keeps state, against both stores
- [ ] Playwright: two browser contexts see each other's edits, offline edits merge after reconnect, reload offline still opens notes
- [ ] Verify on `wrangler dev`

### Phase 4: Auth

- [ ] Spike Better Auth passkeys on both runtimes (fallback: `@simplewebauthn` with own sessions)
- [ ] First-run setup gated by `SETUP_TOKEN`, then registration closes
- [ ] Passkey sign-in and recovery codes
- [ ] Session checks on HTTP and WebSocket upgrade

### Phase 5: Attachments

- [ ] `BlobStore` adapters: R2 and local disk
- [ ] Upload and download for images and files
- [ ] Offline cache and an upload queue that flushes on reconnect
- [ ] Link-preview unfurl endpoint

### Phase 6: Organising

- [ ] Tags
- [ ] Daily notes (`daily-YYYY-MM-DD`)
- [ ] On-device search (MiniSearch)
- [ ] Ctrl/Cmd+K quick switcher
- [ ] Trash: permanent delete and auto-empty
- [ ] Markdown import and export, whole-workspace zip

### Phase 7: History and sharing

- [ ] Version snapshots on the server and a history panel
- [ ] Restore as a new edit
- [ ] Public read-only share links (`/share/:token`), revocable

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
- [ ] Dockerfile and compose for self-hosting
- [ ] Deployment docs for both paths

## Getting started

You need [Bun](https://bun.sh).

```bash
bun install
bun run --cwd apps/web dev
```

Open http://localhost:5173.

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
