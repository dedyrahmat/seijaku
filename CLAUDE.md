# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

All eleven phases (scaffold, local editor, sync, auth, attachments, organising, history and sharing, importers, PWA, desktop, deploy) are built. `apps/web` is an installable, offline-capable (service worker via vite-plugin-pwa; icons in `apps/web/public`) local-first editor that mirrors every note to a sync server over one WebSocket: nested pages, the block editor, trash, IndexedDB persistence, and the title-bar sync status. `apps/server` runs on Bun (`src/bun.ts`) and on Cloudflare (`src/worker.ts` + Durable Object); sign-in is passkeys plus a 12-word recovery phrase (Better Auth), and notes are end-to-end encrypted: the server stores sealed blobs. `packages/db` is still empty (auth uses Better Auth's own tables). [docs/PLAN.md](docs/PLAN.md) is the source of truth for scope, architecture and phase order; read it before doing anything. What is left needs the user: a real Cloudflare deploy, a real iPhone, and macOS/Linux CI runs (docs/PLAN.md, "Left for you").

**Accounts:** sign-in is optional (notes live on the device until you sign in, then sync turns on and uploads them). Anyone can create an account (passkey or 12-word phrase), each with one encrypted workspace; `SETUP_TOKEN` is an optional sign-up code. A passkey with WebAuthn PRF opens notes on a new device by itself, otherwise the phrase is asked once. The Bun server also serves the web build, and a Dockerfile and compose file ship one container. Signing out forgets the workspace key on that device (notes stay).

`apps/desktop` is the Tauri 2 shell (Rust in `src-tauri`; needs Rust and the MSVC build tools, both installed here). It loads the `apps/web` build, signs in with a bearer token kept in the OS keychain, and owns the tray, the capture hotkey (default Ctrl/Cmd+Alt+Space; on this machine Claude desktop already holds it, so rebind in Settings) and the updater. See docs/PLAN.md phase 10 for the sign-in design and known limits. Only Windows was built and run here; macOS and Linux build through `.github/workflows/desktop.yml`.

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
bun run --cwd apps/server dev          # sync server on http://localhost:8791 (data/seijaku.sqlite)
bun run --cwd apps/server dev:worker   # same server on local workerd via wrangler (port 8791 by default)
SETUP_TOKEN=... bun run --cwd apps/server dev   # require this sign-up code for new accounts (unset: open sign-up)
bun apps/server/scripts/smoke.ts ws://localhost:8791/sync [idleSeconds]   # black-box check of a running server
```

`.claude/launch.json` defines `web` and `server` configurations; run both for sync (Vite proxies `/sync` to the server). To test two devices in one browser use two origins, e.g. `localhost` and `[::1]` (each has its own IndexedDB).

```bash
bun run test:e2e                       # Playwright: two browser contexts against a built app and a Bun server (uses installed Chrome; E2E_CHANNEL=msedge for Edge)
bun run --cwd apps/desktop dev         # tauri dev (starts the web dev server; set the server URL in Settings)
bun run --cwd apps/desktop build       # installers in apps/desktop/src-tauri/target/release/bundle (set TAURI_SIGNING_PRIVATE_KEY to sign updater files)
bun run --cwd apps/server deploy       # Cloudflare: wrangler deploy (see README, Deploy)
```

In a built desktop app, inspect the webview by launching it with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` and talking CDP to `localhost:9222`.

Conventions: Biome defaults (tabs, double quotes), with Tailwind directives enabled for CSS; strict TypeScript from `tsconfig.base.json` (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`); workspace packages are named `@seijaku/<dir>` and export TypeScript source directly (`"main": "src/index.ts"`, no build step). Tests live next to the code as `*.test.ts`. Only `packages/sync` has tests so far; the web app has none yet and was verified by hand in a browser. A change that touches the editor or sidebar needs a browser check, not just typecheck.

## What Seijaku is

Seijaku (静寂) is a local-first note-taking app. The name means the Japanese Zen garden concept of "active calm" and stillness, the opposite of noise and disturbance. That meaning drives the tagline (working: "Active calm. The opposite of noise.") and the design goal: rich and powerful like Notion or Obsidian, with a UI that never confuses or shouts.

Many accounts, each with its own encrypted workspace, on many devices: web, iPhone as an installable PWA (no App Store), and desktop on Windows, macOS and Linux via Tauri 2. Signing in is optional.

## How to work here

- **Start each phase only when the user says so.** The plan is accepted, but the user gives the go-ahead per phase.
- **Match the mockup, board by board.** Before building or changing any screen, read the matching board(s) of the mockup (see Design) and compare the result to them afterwards, including geometry and copy. Never defer a mockup element to a "later phase" or leave it out on your own; if one genuinely cannot work yet, ask the user. The user has asked for this repeatedly.
- **Stop after every phase.** Finish the phase, show it running, and wait for the user's go-ahead before the next one.
- Phases with an unverified dependency begin with a short spike (BlockNote restyling, Better Auth passkeys on both runtimes, Apple export formats). If a spike fails, use the fallback named in the plan and tell the user.
- Keep `docs/PLAN.md` current when a decision changes.
- **No hard-coded UI English.** User-facing text goes through i18next: add the key to `apps/web/src/i18n/en.json` and the Indonesian text to `id.json` in the same change (`bun test apps/web/src/i18n` checks they match). See [docs/TRANSLATING.md](docs/TRANSLATING.md). Native browser dialogs (`confirm`, `prompt`) are not used; call `askConfirm` / `askText` from `components/Dialogs.tsx`.

## Architecture (planned)

Bun-workspace monorepo:

```
apps/web Vite + React + TS SPA, TanStack Router, Tailwind v4, vite-plugin-pwa
apps/desktop Tauri 2 shell that loads the apps/web build
apps/server Hono app with two entry points: worker.ts (Cloudflare), bun.ts (self-host)
packages/db Drizzle schema + migrations (SQLite dialect); see the Database note below
packages/sync Shared Yjs sync protocol + Room logic, used by server and client

```

Things that are easy to get wrong:

- **Database (Drizzle, rc).** `packages/db` holds two Drizzle SQLite schemas: `schema/log.ts` (`doc_log`, the sync log: Bun database file and each Durable Object) and `schema/account.ts` (`key_wrap`, `doc_version`, `share_link`: Bun database file and Cloudflare D1). Better Auth keeps creating and migrating its own tables (user, session, passkey, ...) through its built-in adapter; `user_id` is a plain column, not a foreign key, so drizzle-kit never manages Better Auth's tables. Change a schema, then run `bun run --cwd packages/db db:generate`: it runs drizzle-kit for both sets and `scripts/bundle.ts` turns the folders in `packages/db/drizzle/` into `src/migrations.ts`, so every runtime applies the same SQL without a file system (Bun with drizzle's journal migrator, a Durable Object with its `durable-sqlite` migrator when it wakes, D1 with a small applier in `worker.ts` because drizzle's D1 migrator reads a folder). Server code awaits every query, so one version serves the sync (bun:sqlite, DO) and async (D1) drivers (`apps/server/src/db.ts`). `drizzle-orm` and `drizzle-kit` are on the `rc` tag (1.0.0-rc.5); the Drizzle agent skill is in `packages/db/.agents/skills` and the project MCP server is in `.mcp.json` (run by the installed kit, never `bunx`). Migrations are never run through the MCP server. The small `meta` table (generated auth secret) is still raw SQL.
- **Two hosting targets from one codebase.** Every server feature must work on both Cloudflare (Workers, Durable Objects, D1, R2) and self-hosted Bun (`Bun.serve`, `bun:sqlite`, local disk). Runtime-specific code lives only behind adapter interfaces (`UpdateStore`, `BlobStore`, metadata DB) selected at the entry point. Shared server code must not import `bun:*` or Cloudflare-only APIs.
- **Bun is not the Cloudflare runtime.** Production on Cloudflare runs on workerd. Bun is the package manager, dev and test runner, and the self-host runtime.
- **The server cannot read notes.** Everything stored or relayed is sealed with a key derived from the workspace key (`packages/sync/src/crypto.ts`); docs are named by an HMAC of their local id. Never add a server feature that needs to read note content, titles, tags or files: do it on the device, or design it around keys (history, share links).
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

How phase 4 and end-to-end encryption are put together:

- `apps/server/src/auth.ts` is shared by both runtimes and takes whichever database the entry point has (`bun:sqlite` in `bun.ts`, the D1 binding in `worker.ts`). Its plugin adds `/api/auth/seijaku/status` (`{ signedIn, codeRequired }`), `/sign-up` (phrase-only; the passkey plugin's `resolveUser` makes accounts for passkey sign-up), `/phrase` (phrase sign-in), `/key-wraps`. `newAccount` checks the sign-up code only when `SETUP_TOKEN` is set. Entry points call `auth.userId(headers)` before upgrading `/sync`: Bun keeps a `Room` per user id over `SqlUpdateStore(driver, userId)`, the Worker uses one Durable Object per user id. `createApp` guards `/api/files`. Passkeys: `apps/web/src/auth/keys.ts` asks for the WebAuthn PRF extension and wraps the workspace key under `prfWrapKey` (`crypto.ts`) per passkey.
- Keys: `packages/sync/src/crypto.ts` (Cipher: seal/open per doc, server doc ids, file sealing, key wrapping) and `phrase.ts` (BIP39 phrase, login key and wrapping key from it). The server stores only an HMAC of the login key and the wrapped workspace key. Web side: `apps/web/src/auth/keys.ts` (key in IndexedDB `seijaku-keys`, claim / sign in / unlock / replace phrase) and `session.ts` (`authStore`: phases checking, unclaimed, signed-out, **locked** = signed in but no key, signed-in; `getCipher()` feeds sync and file upload).
- Sync is a blind log: `protocol.ts` frames Subscribe / Push / Entry / Ready / Ack / Snapshot / Notify; `room.ts` holds no Y.Docs; `UpdateStore` is `append / loadAfter / stat / replaceUpTo`. `client.ts` seals updates, opens entries, uploads `encodeStateAsUpdate(doc, serverStateVector)` after Ready, and persists `lastSeq` + state vector per doc (`attachDoc` in `workspace/store.ts`, stored in y-indexeddb's custom store). The client attaches docs before a key exists; they get their server name once it does.
- Tests: `auth.test.ts` (refusals, claim, phrase login, key wraps, rate limit), `sync.test.ts` (including "server never holds readable text or names", wrong key, tampered entry, long-log folding, server reset), `crypto.test.ts` (BIP39 vector, wrap round trip). The passkey and phrase ceremonies were checked in a real browser with a virtual authenticator, on Bun and on `wrangler dev`.
- The Better Auth rate limiter needs a client IP; on bare Bun there is none, so limits share one bucket. Better Auth's `createUser` on the internal adapter takes the endpoint context as a second argument.
- **Dev gotcha:** if port 8791 is taken, the preview tool starts the server on another port and Vite's proxy (8791) quietly misses it, which shows as "cannot reach the server". Stop leftover `wrangler`/`workerd` processes by PID before starting servers. On this machine `caveman-proxy.exe` listens on `127.0.0.1:8787` and must not be stopped, which is why the default port is 8791. To see who holds a port: `Get-NetTCPConnection -State Listen -LocalPort 8791`.

BlockNote 0.57 gotchas learned the hard way:

- `@blocknote/core/yjs` needs `y-prosemirror` and `y-protocols` installed explicitly (Bun does not auto-install the peers). After changing dependencies, delete `apps/web/node_modules/.vite` and restart the dev server or Vite serves a stale bundle.
- The code-block `createPreview` option is declared in the types but never called; do not rely on it. Math is a custom block with a live KaTeX preview.
- A custom block whose `render` mutates DOM outside its `contentDOM` (the math preview) must return `ignoreMutation`, or ProseMirror re-renders it in an endless loop and the tab freezes.
- Slash-menu groups must stay contiguous (`keepGroupsTogether` in `Editor.tsx`); BlockNote keys group headers by name.
- BlockNote's heading and theme CSS is more specific than plain selectors; overrides in `styles.css` use `:root:root` or an `:root` prefix. Level 1 headings have no `data-level` attribute.

## URLs

Readable words, no one-letter segments. Pages live at `/page/Getting-Started-<id>` (title slug for people, trailing id for lookup; `pageLink` builds it, `parsePageSlug` reads it, and `NotePage` rewrites the address after a rename). New routes use full words (`/share/:token`, `/trash`, `/settings`, `/sign-in`). See `docs/PLAN.md`.

## Design

The reference is the mockup at https://claude.ai/artifact/2oncbwyZeMDyVdZkDGwNJQ (Washi & ink tokens, sidebar, title bar, note body, home). Tokens live in `apps/web/src/styles.css` (paper, panel, raised, hover, ink, ink2, mute, line, callout, code, tag, vermilion accent); fonts are Newsreader, Hanken Grotesk, JetBrains Mono. Boards: Home (splash with rotating haiku), Main/Editor-Dark/Tablet/Phone-* (shell), Sidebar, Titlebar, NoteBody, Blocks (slash menu), Switcher, Trash, Import-Choose/Progress, Sync-States, History, Share, Public-Page, Sign-In/Setup/Recovery, Quick-Capture. Built so far: Settings (all eight tabs, as a dialog at `/settings/<section>`; preferences live in `apps/web/src/preferences.ts` and are applied to `<html>` as `data-theme` and CSS variables), History and Share panels in the title bar (live: sealed snapshots with preview and restore, and share links), Sign-In/Setup/Recovery screens (`/sign-in`, `/setup`, `/recovery-codes`; live since phase 4), Public-Page (`/share/<token>#<key>`, opens a sealed shared page in the browser), Quick-Capture (`/capture`, appends to today's note), the New-note picker (`NewNoteDialog`: six note kinds with templates in `editor/templates.ts`, Journal entries `journal-YYYY-MM-DD` under a fixed `journal` page, and a "Still to do" list of unticked checklist to-dos on Today), Select pages (sidebar and Trash: checkboxes, Ctrl/Cmd and Shift-click, `useSelection`; the row menu names real pages: "Put inside “X”", "Move out of “Y”"), a phone header with a More menu, Import-Progress, Home, Sidebar (search, Today, Pages, Tags, Trash/Import/Settings), Titlebar (back, forward, sync status; history, share and more are phase 7), Switcher, Trash, Import (all nine sources; Apple Notes and Apple Journal read folders of HTML/Markdown/text because their real export formats are unconfirmed), Sync-States, tags and "Edited" row under the title, and (phase 13, built) note types with their own heads in `components/heads.tsx`, per-type fields (`setField`, flat `f.<kind>.<key>` keys on the note map), the quick-notes wall at `/quick-notes`, Change type in the More menu and one icon set in `components/Icon.tsx`, to-dos with a due date, priority and owner (`editor/todoProps.ts` extends BlockNote's `checkListItem`), ticked to-dos sinking to the bottom of a checklist, a study note's "On this page" rail, and (phase 14) the slash menu's "Blocks" group, Ctrl+Shift+F "search all pages", the capture target picker (`captureTo` preference), "N images saved" on import, and a frameless desktop window (`WindowControls`; unverified in the running app). (Phase 15, built) the device-only Settings rows: workspace name (a synced `settings` map in the index doc), Open on start (`startPage.ts`), spellcheck, smart punctuation, auto-pair and paste style (`editor/typing.ts`, `typingExtension.ts`), Manage links, Clear cache (`clearPending.ts` wipes on the next start), Lock after inactivity (`auth/idleLock.ts`, `authStore.lock()`, a "Locked" Unlock page) and the About dialogs; boards for them are in `docs/boards/phase-15.html`. Language is real i18n (i18next; `apps/web/src/i18n/en.json` and `id.json`; see docs/TRANSLATING.md), and the three desktop-only rows (capture window on top, launch at login, keep running in the tray) are live in the desktop app (phase 16). Not wired yet: Delete account (phase 17).

"Washi & ink": warm paper-toned light theme, sumi-ink dark theme, following the system setting. Generous whitespace, serif headings with a sans body, chrome that recedes while writing. Use the `frontend-design` skill when building UI.

```
```
