# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Phases 1 (scaffold), 2 (local editor) and 3 (sync) are done. `apps/web` is a local-first editor that mirrors every note to a sync server over one WebSocket: nested pages, the block editor, trash, IndexedDB persistence, and the title-bar sync status. `apps/server` runs on Bun (`src/bun.ts`) and on Cloudflare (`src/worker.ts` + Durable Object); sync is unauthenticated until phase 4. `packages/db` is still empty. [docs/PLAN.md](docs/PLAN.md) is the source of truth for scope, architecture and phase order; read it before doing anything. Next is phase 4 (auth), which starts after the user's go-ahead.

`apps/desktop` is only a placeholder `package.json`. Tauri needs Rust, which is not installed on this machine; install it (rustup) before phase 10.

## Commands

Run from the repo root with Bun.

```bash
bun install            # install all workspace dependencies
bun run typecheck      # tsc --noEmit in every workspace package
bun run lint           # biome check . (lint + format check)
bun run format         # biome format --write .
bun test               # run all tests (bun:test)
bun test path/to/file.test.ts          # one test file
bun test -t "name pattern"             # tests whose name matches
bun run --cwd apps/web dev             # Vite dev server on http://localhost:5173
bun run --cwd apps/web build           # production build (apps/web/dist)
bun run --cwd apps/server dev          # sync server on http://localhost:8787 (data/seijaku.sqlite)
bun run --cwd apps/server dev:worker   # same server on local workerd via wrangler (port 8787 by default)
bun apps/server/scripts/smoke.ts ws://localhost:8787/sync [idleSeconds]   # black-box check of a running server
```

`.claude/launch.json` defines `web` and `server` configurations; run both for sync (Vite proxies `/sync` to the server). To test two devices in one browser use two origins, e.g. `localhost` and `[::1]` (each has its own IndexedDB). Deploy commands will be added in phase 11.

Conventions: Biome defaults (tabs, double quotes), with Tailwind directives enabled for CSS; strict TypeScript from `tsconfig.base.json` (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`); workspace packages are named `@seijaku/<dir>` and export TypeScript source directly (`"main": "src/index.ts"`, no build step). Tests live next to the code as `*.test.ts`. Only `packages/sync` has tests so far; the web app has none yet and was verified by hand in a browser. A change that touches the editor or sidebar needs a browser check, not just typecheck.

## What Seijaku is

Seijaku (静寂) is a local-first note-taking app. The name means the Japanese Zen garden concept of "active calm" and stillness, the opposite of noise and disturbance. That meaning drives the tagline (working: "Active calm. The opposite of noise.") and the design goal: rich and powerful like Notion or Obsidian, with a UI that never confuses or shouts.

Single user (the owner) on many devices: web, iPhone as an installable PWA (no App Store), and desktop on Windows, macOS and Linux via Tauri 2.

## How to work here

- **Start each phase only when the user says so.** The plan is accepted, but the user gives the go-ahead per phase.
- **Match the mockup, board by board.** Before building or changing any screen, read the matching board(s) of the mockup (see Design) and compare the result to them afterwards, including geometry and copy. Never defer a mockup element to a "later phase" or leave it out on your own; if one genuinely cannot work yet, ask the user. The user has asked for this repeatedly.
- **Stop after every phase.** Finish the phase, show it running, and wait for the user's go-ahead before the next one.
- Phases with an unverified dependency begin with a short spike (BlockNote restyling, Better Auth passkeys on both runtimes, Apple export formats). If a spike fails, use the fallback named in the plan and tell the user.
- Keep `docs/PLAN.md` current when a decision changes.

## Architecture (planned)

Bun-workspace monorepo:

```
apps/web        Vite + React + TS SPA, TanStack Router, Tailwind v4, vite-plugin-pwa
apps/desktop    Tauri 2 shell that loads the apps/web build
apps/server     Hono app with two entry points: worker.ts (Cloudflare), bun.ts (self-host)
packages/db     Drizzle schema + migrations (SQLite dialect)
packages/sync   Shared Yjs sync protocol + Room logic, used by server and client
```

Things that are easy to get wrong:

- **Two hosting targets from one codebase.** Every server feature must work on both Cloudflare (Workers, Durable Objects, D1, R2) and self-hosted Bun (`Bun.serve`, `bun:sqlite`, local disk). Runtime-specific code lives only behind adapter interfaces (`UpdateStore`, `BlobStore`, metadata DB) selected at the entry point. Shared server code must not import `bun:*` or Cloudflare-only APIs.
- **Bun is not the Cloudflare runtime.** Production on Cloudflare runs on workerd. Bun is the package manager, dev and test runner, and the self-host runtime.
- **Notes are CRDTs, not rows.** A workspace has one Yjs _index doc_ (note tree, titles, tags, trash) and one Yjs doc per note. The SQL database holds only auth, sessions, attachment records, shares and version snapshots. Do not add note content tables.
- **One WebSocket per device**, to a single workspace room that multiplexes all docs by docId. On Cloudflare the room is one Durable Object using WebSocket hibernation.
- **Local-first.** The client must work fully offline from IndexedDB; the server is the durable copy, not a requirement for reading or editing. Search runs on-device (MiniSearch), not on the server. Importers run in the browser.
- **Daily notes use deterministic ids** (`daily-YYYY-MM-DD`) so offline devices converge on one note.
- **Desktop sign-in does not use WebAuthn in the webview.** It opens the system browser and returns through a `seijaku://` deep link with a one-time code.
- **Editor is BlockNote, core packages only** (MPL). Do not add the GPL-licensed "XL" packages.

How phase 2 is put together:

- The note-tree model is pure functions over a `Y.Doc` in `packages/sync/src/workspace.ts` (create, move, `nudgeNote`, trash, `buildTree`). Keep UI out of it; it is what the server and importers will share. Each note is a nested `Y.Map` so concurrent field edits merge; concurrent moves can form a cycle, which `buildTree` surfaces at the root instead of losing notes.
- `apps/web/src/workspace/store.ts` owns the index doc and per-note docs, each persisted with `y-indexeddb` (`seijaku-index`, `seijaku-note-<id>`) and attached to the `SyncClient` only after IndexedDB has loaded. After each connect it also mirrors notes that are not open ("catch-up", transient docs that are dropped from memory once synced), and the server's `notify` frames trigger the same for notes changed elsewhere. Components read through `hooks.ts` (`useSyncExternalStore`); the snapshot reference only changes when the index changes.
- The editor binds to a note doc with `withCollaboration` from `@blocknote/core/yjs`. Custom blocks (callout, math) are in `apps/web/src/editor/schema.ts`.
- Sidebar reorder works by drag and drop _and_ by the row menu (up, down, indent, outdent), because HTML5 drag is unreliable on iPhone.

How phase 3 is put together:

- `packages/sync`: `protocol.ts` (frames), `room.ts` (server hub, runtime-agnostic, talks to sockets through `RoomConnection` and to disk through `UpdateStore`), `client.ts` (`SyncClient`: reconnect with backoff, status, ack counting), `store.ts` (`UpdateStore` + in-memory store for tests). The Room acks an update only after it is stored; the client's status is "syncing" until every ack is back.
- `apps/server`: `sql-store.ts` is the one SQL implementation of `UpdateStore`, behind a `SqlDriver` that `bun.ts` (bun:sqlite) and `room-do.ts` (DO SQLite) each implement. `worker.ts`/`room-do.ts` are type-checked by `tsconfig.worker.json` (workers types), everything else by `tsconfig.json` (bun types); do not import across that line.
- A Durable Object loses its Room when it hibernates; `room-do.ts` re-creates a Peer per open socket and sends `resync` so devices subscribe again. Keep any new per-socket server state recoverable that way.
- UI follows the mockup's "Sync, said quietly": `components/SyncStatus.tsx` (dot + label; click for the plain-language line), `NoteFooter.tsx` (word count, "Saved on this device").

BlockNote 0.57 gotchas learned the hard way:

- `@blocknote/core/yjs` needs `y-prosemirror` and `y-protocols` installed explicitly (Bun does not auto-install the peers). After changing dependencies, delete `apps/web/node_modules/.vite` and restart the dev server or Vite serves a stale bundle.
- The code-block `createPreview` option is declared in the types but never called; do not rely on it. Math is a custom block with a live KaTeX preview.
- A custom block whose `render` mutates DOM outside its `contentDOM` (the math preview) must return `ignoreMutation`, or ProseMirror re-renders it in an endless loop and the tab freezes.
- Slash-menu groups must stay contiguous (`keepGroupsTogether` in `Editor.tsx`); BlockNote keys group headers by name.
- BlockNote's heading and theme CSS is more specific than plain selectors; overrides in `styles.css` use `:root:root` or an `:root` prefix. Level 1 headings have no `data-level` attribute.

## URLs

Readable words, no one-letter segments. Pages live at `/page/Getting-Started-<id>` (title slug for people, trailing id for lookup; `pageLink` builds it, `parsePageSlug` reads it, and `NotePage` rewrites the address after a rename). New routes use full words (`/share/:token`, `/trash`, `/settings`, `/sign-in`). See `docs/PLAN.md`.

## Design

The reference is the mockup at https://claude.ai/artifact/2oncbwyZeMDyVdZkDGwNJQ (Washi & ink tokens, sidebar, title bar, note body, home). Tokens live in `apps/web/src/styles.css` (paper, panel, raised, hover, ink, ink2, mute, line, callout, code, tag, vermilion accent); fonts are Newsreader, Hanken Grotesk, JetBrains Mono. Boards: Home (splash with rotating haiku), Main/Editor-Dark/Tablet/Phone-* (shell), Sidebar, Titlebar, NoteBody, Blocks (slash menu), Switcher, Trash, Import-Choose/Progress, Sync-States, History, Share, Public-Page, Sign-In/Setup/Recovery, Quick-Capture. Built so far: Home, Sidebar (search, Today, Pages, Tags, Trash/Import/Settings), Titlebar (back, forward, sync status; history, share and more are phase 7), Switcher, Trash, Import (Markdown, HTML, plain text work; the other sources say "Coming soon"), Sync-States, tags and "Edited" row under the title. Not built: History, Share, Public-Page, Sign-In/Setup/Recovery, Import-Progress, Quick-Capture, and the app-specific importers. Settings has no board, so it follows the Trash page's layout.

"Washi & ink": warm paper-toned light theme, sumi-ink dark theme, following the system setting. Generous whitespace, serif headings with a sans body, chrome that recedes while writing. Use the `frontend-design` skill when building UI.
