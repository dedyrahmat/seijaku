# Seijaku — build plan

## Context

Seijaku (静寂) is a new note-taking app: the Japanese Zen garden concept of "active calm" and stillness, the opposite of noise and disturbance. That meaning drives the tagline (working: **"Active calm. The opposite of noise."**) and the design: rich and powerful like Notion/Obsidian, but with a UI that stays out of the way.

`F:\MyProject\seijaku` is empty (no git repo). Everything below is greenfield.

### Decisions confirmed with the user

> **Reworked 2026-11-17:** sign-in is optional, anyone can create an account (one encrypted workspace each), `SETUP_TOKEN` is an optional sign-up code, a passkey alone opens notes where it supports PRF, and self-hosting ships as one container. This replaces the "Audience" row, the first-run setup under "Auth" and the passkey caveat under "End-to-end encryption" below, which describe the first version.

| Area          | Decision                                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Audience      | Many accounts, each with its own encrypted workspace, on many devices. Signing in is optional.                                                                                       |
| Platforms     | Web, iPhone via installable PWA, desktop (Win/Mac/Linux) via **Tauri 2**                                                                                                             |
| Editor        | Hybrid: Notion-style blocks + Markdown shortcuts + Markdown import/export                                                                                                            |
| Offline       | Full local-first: every note on device, edits merge on reconnect                                                                                                                     |
| Hosting       | **Both** Cloudflare and self-hosted Bun, from one codebase                                                                                                                           |
| Frontend      | Vite + React SPA, TanStack Router                                                                                                                                                    |
| ORM / tooling | Drizzle (SQLite dialect), Bun for package manager, dev, tests, self-host runtime                                                                                                     |
| Sign-in       | Passkey and a 12-word recovery phrase (like a crypto wallet). The phrase also restores the encryption key                                                                            |
| Privacy       | **End-to-end encrypted** (added after phase 4): the server stores sealed blobs and cannot read notes or files                                                                        |
| v1 features   | Nested pages, images + attachments, tags, daily notes, full-text search, Ctrl/Cmd+K switcher, trash, version history, desktop quick capture, public read-only share links, importers |
| v1 blocks     | Text, headings, lists, to-dos, quotes, dividers, images, code (syntax highlighting), simple tables, callouts, toggles, math (KaTeX), embeds (link previews, video)                   |
| Import        | Obsidian, Notion, Google Keep, Apple Notes, Apple Journal, Evernote, plus generic Markdown/HTML/text for everything else                                                             |
| Later         | [[wiki links]] + backlinks, Notion-style databases, collaborative sharing                                                                                                            |
| Working style | **Stop after every phase**, show it running, wait for the user's go-ahead                                                                                                            |
| Look          | "Washi & ink": warm paper light theme, sumi-ink dark theme, serif headings, follows system                                                                                           |

## Architecture

Bun-workspace monorepo:

```
apps/web        Vite + React + TS SPA, TanStack Router, Tailwind v4, vite-plugin-pwa
apps/desktop    Tauri 2 shell that loads the apps/web build
apps/server     Hono app + two entry points: worker.ts (Cloudflare), bun.ts (self-host)
packages/db     Drizzle schema + migrations (SQLite dialect, shared by D1 and bun:sqlite)
packages/sync   Shared sync protocol + Room logic (Yjs), used by server and client
```

### Data model (CRDT, Yjs)

- **Index doc** (one per workspace): the note tree. Per note: id, title, parentId, sort order, icon, tags, trashed flag, timestamps. Makes the sidebar, tags and trash sync live and work offline.
- **Note doc** (one Y.Doc per note): the block content, bound to the editor.
- Daily notes use a deterministic id (`daily-YYYY-MM-DD`) so two offline devices creating "today" converge on one note.
- Client persistence: `y-indexeddb`. Call `navigator.storage.persist()`; the server remains the durable copy (matters for iOS storage eviction).

### End-to-end encryption

Decided after phase 4, on the user's request: notes are sealed on the device, so the server (Bun or Cloudflare) cannot read them.

- One random 256-bit **workspace key** (WK). Per-doc keys come from it with HKDF; every update is sealed with AES-256-GCM (noble, synchronous so ordering is simple), the doc's local id bound in as authenticated data. Files are sealed the same way with the name and type inside.
- The server names docs by `d` + HMAC(local id) so `daily-2026-11-16` and note ids are not visible. It keeps an ordered log of opaque blobs per doc (`doc_log`: seq, doc id, blob) and relays them. It does no merging: devices do.
- WK reaches new devices through the **recovery phrase**: 12 BIP39 words. HKDF turns the phrase's seed into a _login key_ (the server stores only an HMAC of it, so it can recognise the phrase) and a _wrapping key_ (never leaves the device; wraps WK). The server stores WK only wrapped.
- A passkey opens notes on a new device through the WebAuthn PRF extension (its PRF output wraps WK, one wrap per passkey). Without PRF support the device shows "Unlock" and asks for the phrase once. Signing out forgets WK on that device.
- **Limits, stated plainly:** lose the phrase and every signed-in device and the notes are gone, with no server-side reset. The server still sees sizes, timing and the number of docs. The notes and the key in this browser's IndexedDB are not encrypted at rest, so this protects against the server, not against someone using an unlocked browser. Search stays on-device, so it is unaffected. Version history and share links (phase 7) must be built around it: clients make snapshots, and a share link carries a key in the URL fragment.
- Server data from before this change was plaintext and is dropped; devices send their copies again, sealed.

### Sync

- One WebSocket per device to a single **workspace room**, multiplexing all docs by docId (state-vector diff on connect, then live updates; background catch-up of notes not currently open). One connection instead of one per note.
- `packages/sync` holds the `Room` class and message encoding (built on `y-protocols`), written against a small `UpdateStore` interface (append update, load doc, compact).
- **Cloudflare adapter**: `WorkspaceRoom` Durable Object with WebSocket hibernation; `UpdateStore` on the DO's SQLite via Drizzle `durable-sqlite`.
- **Bun adapter**: in-process room, `Bun.serve` WebSockets; `UpdateStore` on `bun:sqlite` via Drizzle.
- Update log is compacted into snapshots periodically.

### Server (Hono, runs on both runtimes)

Adapter interfaces chosen at the entry point:

| Concern                                                   | Cloudflare            | Self-host                                 |
| --------------------------------------------------------- | --------------------- | ----------------------------------------- |
| Metadata DB (auth, sessions, devices, attachment records) | D1                    | bun:sqlite file                           |
| Realtime room + doc storage                               | Durable Object SQLite | in-process + bun:sqlite                   |
| Blobs (`BlobStore`)                                       | R2                    | local disk (S3-compatible optional later) |
| Static SPA                                                | Workers static assets | served by Bun                             |

### Auth

- Better Auth with the passkey plugin and Drizzle adapter (fallback: `@simplewebauthn` + own session table if it fights either runtime).
- Anyone can create an account (passkey or 12-word phrase); `SETUP_TOKEN`, when set, is a sign-up code every new account must enter. One sync room per account (a Durable Object or `Room` per user id). Sign-in is optional: the app works from IndexedDB without it, and signing in uploads the local notes.
- Web/PWA: httpOnly session cookie. WebSocket upgrade checks the session.
- **Desktop**: WebAuthn inside the Tauri webview is unreliable, so sign-in opens the system browser and returns via `seijaku://` deep link with a one-time code, exchanged for a device token kept in the OS keychain. Desktop has a "server URL" setting (needed for self-host).

### Editor and features

- **BlockNote** (built on Tiptap/ProseMirror; slash menu, drag handles, Yjs binding, Markdown conversion out of the box), restyled to the Washi & ink theme. Core packages only (MPL); avoid the GPL "XL" packages.
- Attachments: paste/drop → `BlobStore`; cached client-side for offline; uploads made offline queue in IndexedDB and flush on reconnect.
- Search + quick switcher: on-device index (MiniSearch) built from local docs, since all notes are local. No server search needed.
- Trash: soft delete in the index doc, restore or purge.
- Markdown import/export per note and whole-workspace export (zip).
- Blocks: code, tables, toggles, and image/video/audio/file come from BlockNote; callout and math (KaTeX) are custom blocks. Link-preview embeds need a small server unfurl endpoint (cached) and are still to build.

### Version history

- Server stores periodic per-note snapshots (full Yjs state) in a `versions` table: on idle after edits, capped and thinned with age.
- History panel lists versions, previews one read-only, and restores by writing the old content as a new edit (so restore itself syncs and is undoable). Browsing history needs a connection.

### Public share links

- `shares` table in the metadata DB: note id, random token, created/revoked. Toggle per note, revocable.
- `/share/:token` serves a read-only render of that one note (no sidebar, no auth), with its images served through share-scoped URLs. Child pages are not exposed.

### Desktop quick capture

- Tauri global-shortcut + tray plugins; a small frameless capture window that appends to today's daily note (or a new note), works offline, and closes on Enter/Esc. Hotkey is configurable.

### Importers

- Run in the browser (zip parsing with `fflate`), so they work offline and identically on both hosts.
- Plugin shape: each importer turns a file/zip into a common intermediate form (notes with title, parent path, tags, dates, block content, attachments), then one shared writer creates notes and uploads attachments.
- v1 importers: Obsidian vault (Markdown folder/zip, incl. frontmatter tags and `![[image]]` embeds), Notion export zip (Markdown + CSV, page nesting), Google Keep (Google Takeout JSON), Evernote (ENEX), Apple Notes, Apple Journal, and generic Markdown / HTML / plain text.
- "Any other app" is covered by the generic importers plus the plugin shape, not by a bespoke importer per app.
- **Unverified**: the exact export formats for Apple Notes and Apple Journal. Confirm against real exports at the start of the import phase; ask the user for a small sample export from each app they actually use.

### URLs

Addresses are readable words, never one-letter codes. Pages are `/page/Getting-Started-<id>`: the title slug is for people, the trailing id is what the app looks up, so renaming a page never breaks an old link and the app rewrites the address to match the new title. Helpers are `pageSlug` and `parsePageSlug` in `packages/sync/src/slug.ts`; routes build links with `pageLink` (`apps/web/src/components/pageLink.ts`). Every future route follows the same rule: full English words, no abbreviations (`/share/:token`, `/trash`, `/settings`, `/import`, `/sign-in`, `/daily/2026-11-15`).

### Design

Washi & ink tokens as CSS variables (light + dark, system-following), generous whitespace, serif headings with a sans body, sidebar and toolbars that fade while typing. Use the `frontend-design` skill when building the shell.

## Phases

Each phase ends in something runnable. **Stop after each phase**, demo it, and wait for the user's go-ahead. Phases with an unverified dependency start with a short spike.

1. **Scaffold** (DONE): check installed tools (bun, git, rust), `git init`, Bun workspaces, TypeScript, Biome, test setup, empty apps/packages.
2. **Local editor** (DONE): spike BlockNote restyling first. App shell, theme, index doc + note tree (nested pages, reorder), editor bound to Y.Doc with all v1 blocks except embeds' link previews, IndexedDB persistence. Fully usable offline on one device.
   - Done: nested pages with drag reorder and a keyboard/touch menu, soft-delete trash with restore, hybrid editor (Markdown shortcuts, slash menu), callout, math (live KaTeX), tables, toggles, code, check lists, image/video/audio/file blocks, Washi & ink light and dark themes, quiet-chrome fade while typing, mobile drawer layout. Content persists across reloads from IndexedDB.
   - Changed: math is its own block, not a code-block language, because BlockNote 0.57 declares but never calls `createPreview`.
   - Not yet (later phases): the app shell itself does not load offline until the service worker (phase 9); images cannot be uploaded, only linked by URL (phase 5); link-preview embeds (phase 5); trash has no permanent delete or auto-empty (phase 6); no web app tests, only `packages/sync`.
   - Known: the main JS bundle is ~1.8 MB (575 kB gzip), mostly BlockNote and syntax highlighting. Code-split before phase 9.
3. **Sync** (DONE): `packages/sync` Room + protocol, Bun adapter first (simplest dev loop), client provider with reconnect/backoff and background catch-up, then the Cloudflare DO adapter.
   - Done: one WebSocket per device carrying every doc. Frames are `docId | kind | payload`: `sync` (y-protocols step 1/2/update), `ack` (server has stored it, so "Synced" is honest), `notify` (a doc you are not watching changed; the client fetches it in the background and drops it from memory), `unsubscribe`, `resync` (a woken Durable Object asks devices to subscribe again). Text `ping`/`pong` keep-alive detects half-open sockets. The update log compacts into one merged update after 100 entries. Title bar status, word count and "Saved on this device" footer follow the mockup's Sync-States and Main boards.
   - Changed: the DO store uses raw SQL through a small `SqlDriver` (shared with `bun:sqlite`) instead of Drizzle `durable-sqlite`; `packages/db` is still for auth and metadata in phase 4.
   - Added afterwards, from a review against the mockup (these had been wrongly deferred): the Home splash with rotating haiku (no longer redirects to the last note), the full sidebar, Ctrl/Cmd K switcher with on-device body search, daily notes (`daily-YYYY-MM-DD`, Today row), tags, a Trash page with Delete forever and Empty trash, back/forward in the title bar, a generic Import page (Markdown, HTML, plain text), a Settings page (server address), and image/file upload: `POST /api/files` and `GET /api/files/:id` on both runtimes behind a `BlobStore` (disk for self-host, R2 on Cloudflare), wired to BlockNote's `uploadFile` so the slash menu, paste and drop all upload. Uploads need a connection (no offline queue yet) and files are served with `nosniff` and a sandbox CSP, non-media types only as downloads.
   - Not yet: the server address is the page's own origin (the saved "server URL" override is read but has no settings screen until phase 10); "Keep your notes safe" only appears on iPhone/iPad Safari outside the Home Screen app, since the copy tells people to add it there; the Durable Object was checked on `wrangler dev` (including a 25 s idle) but not on a deployed Cloudflare account, and hibernation itself was not confirmed.
4. **Auth** (DONE): spike first, then setup, passkey and phrase sign-in, end-to-end encryption, session checks on HTTP and WS.
   - Spike: Better Auth 1.7 with the passkey plugin loads and migrates on workerd (D1) and on Bun (`bun:sqlite`), so the SimpleWebAuthn fallback was not needed. It takes the raw database (a `bun:sqlite` Database or the D1 binding) through its built-in adapters, so **Drizzle is not used for auth**; `packages/db` stays empty until a feature needs its own tables.
   - Done: `apps/server/src/auth.ts` (shared by both runtimes) wraps Better Auth. First-run setup uses the passkey plugin's passkey-first registration: the setup token travels as the registration `context` and `resolveUser` checks it, so there is no account until a passkey exists. "Claimed" means at least one passkey exists; after that registration needs a session. A database hook refuses a second user. (Replaced by the recovery phrase; see below.) `GET /api/auth/seijaku/status` tells the app who it is. The WebSocket upgrade (Bun and the Worker, before the Durable Object) and `/api/files` return 401 without a session. Sessions are httpOnly cookies, 90 days.
   - Web: `apps/web/src/auth/session.ts` is the session store. A device that was signed in opens straight from IndexedDB and stays signed in while the server is unreachable; only the server saying "no" signs it out (the sync client's new `onConnectFailed` hook asks). `Shell` sends signed-out devices to `/sign-in`, and unclaimed servers to `/setup`. Settings: passkeys (list, add, remove), recovery phrase (make a new one), signed-in devices (each with Sign out), Sign out everywhere.
   - Config: `SETUP_TOKEN` (Bun prints a one-run token when unset), `AUTH_SECRET` (otherwise made and kept in the database), `SEIJAKU_ORIGIN` (comma-separated page origins; the Bun default covers the Vite dev server, the Worker falls back to the request's origin), `SEIJAKU_RP_ID`.
   - Changed: the mockup's Email, Password and Two-step rows in Security are replaced by Passkeys, because there is no password.
   - **Reworked after the first version** (user asked for phrase login like a crypto wallet, and for end-to-end encryption; see "End-to-end encryption"): the eight recovery codes are gone, because a code can sign in but cannot decrypt. A 12-word phrase replaces them. Setup offers **Create passkey** or **Generate a phrase instead** (phrase-only, no passkey); both end on "Keep this phrase safe". Sign-in offers passkey or phrase; `/unlock` handles a signed-in device without the key. Endpoints: `/api/auth/seijaku/claim`, `/phrase`, `/key-wraps` (GET list, POST store), `/status`. Settings → Security has "Make a new phrase", which ends the old one. Sync protocol rewritten (Subscribe / Push / Entry / Ready / Ack / Snapshot); the server Room no longer holds Y.Docs. Devices remember how far into each doc's log they have read (`lastSeq`) and which state the server holds (a state vector) in y-indexeddb, so a reload does not move whole docs; a server that lost its data is detected and refilled. A device that sees more than 100 entries for a doc folds them into one snapshot.
   - Fixed in the same pass: the sign-in page said "cannot reach the server" because a leftover `wrangler dev` of mine held port 8787, so the real server had silently moved to 8788 behind Vite's proxy. The sign-in page now has Try again and "New server? Set it up", and setup no longer bounces away while the server is unreachable.
   - Not yet: a WebAuthn PRF shortcut so a passkey sign-in on a new device could unlock without typing the phrase (needs per-authenticator support and a real device to check); Delete account (disabled, "Not available yet"); "Lock after inactivity" (disabled); D1 tables are created at first request, real `wrangler d1` migrations come in phase 11; rate limiting has no client IP on a bare Bun server (one shared bucket), so self-host behind a proxy that sets `X-Forwarded-For`; signing out leaves the notes in this browser's IndexedDB; not tried on a deployed Cloudflare account.
   - **Accounts rework (done 2026-11-17):** optional sign-in, many accounts with one room each, optional sign-up code, passkey unlock through PRF (checked with a virtual authenticator, PRF on and off), dev port 8791, and a one-container self-host with the Bun server serving the web build. `docs/AUTH-REWORK.md` was folded in here. Not checked: `docker build` and a deployed Cloudflare account.
5. **Attachments** (DONE): BlobStore adapters, upload/download, offline cache and queue; link-preview unfurl endpoint.
   - Done: files are sealed on the device and addressed by the first 12 bytes of the SHA-256 of the sealed bytes (`blobIdFor`), so a file added offline already has its final address. `PUT /api/files/:id` checks the bytes match and is idempotent, which makes retries safe. `apps/web/src/workspace/files.ts` keeps every seen or added file in the Cache API (`seijaku-files`) so images show offline, and queues uploads made while offline (`seijaku-file-queue`), flushing on `online`, on sign-in and every 30 s. Adding a file while signed out still says "Sign in to add files", because sealing needs the workspace key.
   - Link previews: `GET /api/unfurl?url=` (signed-in only) fetches the page and returns title, description and site name; no image, so viewing a card never contacts a third party. A "Link preview" block asks once when a link is pasted and stores the answer in the block, so the card works offline. **Privacy cost, stated plainly:** the server learns which links you preview. SSRF guards: http(s) only, no credentials, private/loopback/link-local names and addresses refused (also after every redirect, max 3), self-host resolves the name and refuses inner addresses, 5 s timeout, 512 KB cap, HTML only.
   - Not yet: no "waiting to upload" count in the sync status; the unfurl DNS check can be raced by a hostile DNS server (rebinding; noted in the code); the unfurl answer is not cached on the server; no per-account file ownership or quota; unfurl is not checked on a deployed Cloudflare account.
6. **Organising** (DONE): tags, daily notes, search, quick switcher, trash, Markdown import/export.
   - Most of this landed early, in the phase 3 catch-up pass (tags, daily notes, switcher, search, trash page with Delete forever and Empty trash, Markdown/HTML/text import). Phase 6 added what was left:
   - **Auto-empty trash:** the index now records `trashedAt` (restoring clears it); `purgeExpired` deletes trash entries older than the "Empty trash automatically" setting (7 or 30 days, or never; notes trashed before this count from their last edit). The workspace sweeps once the index loads, hourly, and when the setting changes. Because the default is 30 days, the first sweep after upgrading can delete older trash.
   - **Markdown export:** `apps/web/src/export.ts`. "Export as Markdown" in a page's ··· menu, and Settings → Data → Export all (a zip laid out like the page tree, a folder per page that has sub-pages). Images and files are opened on the device and put in `attachments/`, the zip is made in the browser (fflate), and nothing goes to the server. Callouts become quotes, math becomes `$$ … $$`, link previews become links. Trashed pages are left out.
   - **Search:** kept the own on-device implementation (`packages/sync/src/search.ts`: every word must match, titles rank first, `#tag` lists a tag) instead of MiniSearch; it needs no dependency and is tested. Swap it in if fuzzy matching is wanted.
   - Not yet: the Seijaku archive importer (Settings still lists it) and re-importing an export zip; export uses BlockNote's lossy Markdown, so some formatting (colours, column layout) is dropped; permanent delete removes the page from the index but leaves its content doc on the server.
7. **History + sharing**: version snapshots and history panel; public share links.
8. **Importers**: intermediate format + writer, then Obsidian, Notion, Keep, Evernote, Apple Notes, Apple Journal, generic.
9. **PWA**: service worker app-shell caching, manifest, icons, iPhone home-screen polish (safe areas, keyboard handling).
10. **Desktop**: Tauri 2 shell, deep-link sign-in, server URL setting, quick capture (hotkey + tray), auto-updater, GitHub Actions builds for Win/Mac/Linux.
11. **Deploy**: `wrangler.jsonc` (DO, D1, R2, assets) + D1 migrations; Dockerfile and compose for self-host; README for both paths. (The Dockerfile, compose file, Bun serving the web build and the Workers assets entry move into the accounts rework; D1 migrations and a real Cloudflare deploy stay here.)

## Verification

- `bun test`: Room logic with two simulated clients (concurrent edits converge, offline edits merge, compaction preserves state) run against both `UpdateStore` implementations.
- Playwright: two browser contexts editing the same note see each other's changes; go offline, edit both, reconnect, confirm merge; reload offline and confirm notes open.
- Cloudflare path: `wrangler dev`, then a deployed preview; repeat the two-context test.
- Self-host path: `docker compose up`, repeat the two-context test.
- Auth: setup, passkey sign-in, phrase sign-in, unlock, rejected WS without session.
- History/sharing: edit, restore an older version, confirm it syncs to a second context; open a share link logged out, revoke it, confirm 404.
- Importers: fixture exports per format under `apps/web/test/fixtures/import/`, unit-tested through the intermediate form; real exports from the user for Apple formats.
- Desktop: quick-capture hotkey appends to today's note while the main window is closed. `tauri dev` and a built installer on Windows; deep-link sign-in round trip. Mac/Linux builds verified via CI artefacts only (cannot be run from this machine).
- iPhone: install the deployed PWA from Safari, test offline open/edit and passkey sign-in. This step needs the user's device.

## Notes

- After plan approval, save the Seijaku meaning/tagline to memory (the user asked for it to be remembered; plan mode blocked writing it).
- Passkeys need HTTPS and a stable domain in production, including self-host.
- Production on Cloudflare runs on workerd, not Bun; the Bun runtime is used in dev, tests and the self-host build.
