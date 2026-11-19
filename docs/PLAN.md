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
| Later         | [[wiki links]] + backlinks, Notion-style databases, collaborative sharing (now phases 17, 19 and 20)                                                                                 |
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

### Database

Drizzle ORM (1.0 rc, SQLite dialect) owns the tables the server adds itself; Better Auth still creates and migrates its own (user, session, passkey, verification, rateLimit).

| Table         | Where                                           | Holds                                                     |
| ------------- | ----------------------------------------------- | --------------------------------------------------------- |
| `doc_log`     | Bun database file; each Durable Object's SQLite | the sealed sync log (`seq`, `doc_id`, `data`)             |
| `key_wrap`    | Bun file; D1                                    | an account's workspace key wrapped by phrase or passkey   |
| `doc_version` | Bun file; D1                                    | sealed history snapshots (bytes in the blob store)        |
| `share_link`  | Bun file; D1                                    | published sealed pages by token (bytes in the blob store) |

Two schemas (`packages/db/src/schema/log.ts`, `account.ts`) and two migration sets (`drizzle/log`, `drizzle/account`) because the log lives in different databases on Cloudflare (a Durable Object each) than the account tables (D1). `bun run --cwd packages/db db:generate` writes migrations and bundles them into `src/migrations.ts`; each runtime applies the bundled SQL itself (Bun: drizzle's journal migrator; Durable Object: `durable-sqlite` migrator in the constructor; D1: a small applier in `worker.ts`, because drizzle's D1 migrator needs a folder). `user_id` is a plain column, not a foreign key, so drizzle-kit never touches Better Auth's `user` table; deleting an account (not built yet) will need to remove its rows by hand. The Drizzle agent skill and a project MCP server (`.mcp.json`) are set up for working on this.

### Auth

- Better Auth with the passkey plugin on its built-in adapters (the Drizzle adapter was not needed); the server's own account tables are Drizzle (see "Database" below).
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

- A snapshot is a note's whole Yjs state, **sealed on the device** (the server cannot open it). It is taken once a note has been quiet for 2 minutes, when you leave the page, and when the History panel opens (skipped if nothing changed since the last one sent from this tab). The server keeps rows `version` (user, server doc name, sealed meta with words and device, blob id, time) and the bytes in the blob store.
- Thinning (`versionsToKeep`): everything from the last hour; then one per 10 minutes for a day, one per day for a month, one per week after; at most 200 per note. "Keep version history" (30 days, 90 days, Forever) is sent with each snapshot and drops older ones.
- The panel lists Today / Yesterday / Earlier with time, words added and "Synced from this device / another device / Page created". Picking one previews it read-only above the page ("Previewing…", Back to current, Restore this version). Restore snapshots the current page first, then replaces the live content with the old one in a single Yjs transaction, so it syncs and can be undone from the list. Listing needs a connection.

### Public share links

- A shared page is a **sealed copy** published under a random key. The link is `/share/<token>#<key>`: the key sits in the fragment, which browsers never send, so the server hosts bytes it cannot read. The key is also stored on the page's record in the index doc (sealed, synced) so any device can republish or revoke.
- Server: `share` table (user, token, blob id, times) and `PUT /api/shares` (create or replace under the same token), `DELETE /api/shares/:token` (owner only), public `GET /api/shares/:token` (`noindex`, unguessable token). Revoking deletes the copy.
- Images are embedded in the copy (3 MB each, 12 MB total; larger ones are left out), so a shared page needs no other request. Sub-pages are not included. While shared, edits are republished 8 seconds after you stop typing.
- The viewer treats the page as untrusted data: links that are not http(s) or mailto become text and media must be a web address or an embedded image/video/audio before the page is drawn (read-only BlockNote).

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
   - Changed: the DO store first used raw SQL through a small `SqlDriver`; it now uses Drizzle (see "Database").
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
7. **History + sharing** (DONE): version snapshots and history panel; public share links.
   - Done: see "Version history" and "Public share links" above. Tables `version` and `share` come from the Better Auth plugin schema, so they migrate on both Bun and D1; blobs gained `delete`. Checked in a real browser: snapshots, preview, restore, share, opening the link in a fresh session, the link without its key, and revoking.
   - Not yet: no per-account quota on snapshots or shares; a link works for anyone who has it until revoked (no expiry or password); the public page shows no "last updated" time; sharing a page does not share its attachments larger than 3 MB; a shared page is a copy, so it lags edits made while offline until you are online and idle for 8 seconds; version history on Cloudflare was not run on `wrangler dev`.
8. **Importers** (DONE, Apple unverified): intermediate format + writer, then Obsidian, Notion, Keep, Evernote, Apple Notes, Apple Journal, generic.
   - Shape (`apps/web/src/import/`): `model.ts` is the common form (`ImportedNote`: path of parent titles, title, tags, dates, body as Markdown/HTML/text, files by reference, extras, warnings). `archive.ts` reads whatever was picked or dropped (files, a folder, zips, zips inside zips; junk like `__MACOSX` ignored; 1.5 GB cap) into one path-to-bytes map. Each importer is a pure function from that map to `Parsed` (`obsidian.ts`, `notion.ts`, `keep.ts`, `evernote.ts`, `folder.ts`), so they are tested without a browser. `writer.ts` is the one writer: makes parent pages, turns bodies into blocks with BlockNote's parsers, uploads files, writes content with `withFragment`, and makes an "Import report" page listing anything skipped. `sources.ts` lists the nine sources the Import page shows.
   - Obsidian: folders become parent pages; frontmatter and #inline tags become tags (code is left alone); `![[image]]` and Markdown images become images (found by path or by name anywhere in the vault); `[[links]]` become plain text; `%%comments%%` are dropped; `.obsidian` is ignored; canvas files are reported. Notion: ids stripped from names, sub-pages nest under their page, a leading `Tags:` or `Created:` property is read, page links become text, CSV tables are reported (their rows are pages already). Keep: one page per Takeout JSON, labels as tags, checklists as checkboxes, Keep times kept, trash skipped, attachments added at the end. Evernote: one parent page per .enex notebook; `<en-media>` pictures are matched by their MD5 hash; other resources go at the end; `<en-todo>` becomes ☐/☑. Markdown, HTML and plain text: one page per file, folders nest.
   - **Detection:** nobody has to say where notes came from. `detect.ts` looks at the export: an `.enex` file means Evernote, a `.obsidian` folder or [[wikilinks]] mean Obsidian, " <32 hex>" names mean Notion, JSON with Keep's fields means Keep; anything else (including Apple exports) is read as files and folders. The source cards from the mockup stay as an optional override (pick one to force it, pick it again to go back to automatic), and the progress screen names what was found.
   - Done: dates from the source are kept (a note's "Edited" shows its original date). Files need an account (sealed uploads); signed out, text imports and each file left out is reported. Checked in a real browser with an Obsidian zip, a Notion zip, an .enex and a Keep zip, through the Import page.
   - **Unverified:** Apple Notes and Apple Journal. Apple has no official bulk export format I could confirm, so both read a folder or zip of HTML, Markdown or text files with images beside them, which is what the common third-party exporters and a Journal export produce. If you use these apps, send a small real export so a proper importer can be written.
   - Not yet: Obsidian canvases, Notion CSV databases and Keep audio transcripts are not imported; wiki-links are not turned into links between pages; very large vaults hold the whole export in memory; no way to undo an import other than the trash; the Import report is a page, not a downloadable file.
9. **PWA** (DONE): service worker app-shell caching, manifest, icons, iPhone home-screen polish (safe areas, keyboard handling).
   - Done: `vite-plugin-pwa` (generateSW, auto-update) precaches the whole build (~9 MB, mostly BlockNote and Shiki chunks) so the app opens offline; attachments are cached on first view (`/api/files/`); manifest, ink-tile icons (192, 512, maskable, apple-touch) made from the Logo board; iOS meta tags; the phone board's floating formatting bar (insert, text style, to-do, link, undo) rides above the keyboard via `visualViewport`. Checked in the browser pane: service worker active, app loads with the server stopped, toolbar buttons work.
   - **Unverified:** install and offline on a real iPhone (needs the deployed app and your device); the keyboard offset logic is untested on real iOS Safari. Link button uses a plain `prompt()`.
10. **Desktop** (built; see checks below): Tauri 2 shell, deep-link sign-in, server URL setting, quick capture (hotkey + tray), auto-updater, GitHub Actions builds for Win/Mac/Linux.

- How it works: `apps/desktop/src-tauri` (Rust) loads the `apps/web` build. The shell owns the tray, the global capture hotkey (default Ctrl/Cmd+Alt+Space, changeable in Settings, kept in the app config dir), the frameless transparent capture window (`/capture`, label `capture`), the keychain (device token), single-instance and the updater. Closing the main window hides it to the tray.
- Sign-in: the webview is on another origin than the server, so it uses a **bearer token** (Better Auth `bearer` plugin) instead of cookies: `desktop.ts` patches `fetch` to add it, picks up `set-auth-token` from any sign-in, and puts it in the sync URL as `?token=` (sockets cannot send headers). Passkeys: "Sign in with your browser" opens `<server>/desktop-link`, which (after a normal browser sign-in) makes a 2-minute signed code and returns it by `seijaku://signin?code=`; the app trades it at `/api/auth/seijaku/desktop-exchange`. The phrase works directly in the app. The workspace key never travels: a new desktop shows Unlock and asks for the phrase (or the passkey's PRF can not be used in the webview). Server CORS allows `http://tauri.localhost` and `tauri://localhost`.
- Updater: public key in `tauri.conf.json`; the private key is in `~/.tauri/seijaku.key` on this machine (not in git) and must be added as the GitHub secret `TAURI_SIGNING_PRIVATE_KEY`. `.github/workflows/desktop.yml` builds on a `v*` tag into a draft release.
- Known: the capture window and the main window are separate JS contexts on one IndexedDB, so a capture shows in the main window after sync or a reload, not live; a desktop code can be reused for 2 minutes (not one-time); account creation in the desktop app still offers a passkey, which may fail in the webview (use the browser or the phrase); the build is unsigned for Windows and macOS (SmartScreen and Gatekeeper warnings).

11. **Deploy** (DONE): `wrangler.jsonc` (DO, D1, R2, assets) + D1 migrations; Dockerfile and compose for self-host; README for both paths. (The Dockerfile, compose file, Bun serving the web build and the Workers assets entry move into the accounts rework; D1 migrations and a real Cloudflare deploy stay here.)

- Done: `wrangler.jsonc` (Durable Object, D1, R2, assets, SPA fallback); D1 migrations are applied by the Worker on its first request (`migrateD1`), so there is no separate step; `bun run --cwd apps/server deploy`; README has both deploy paths and the desktop release steps. Checked: `wrangler dev` runs the whole app (sign-up on D1, bearer sign-in, sync through the Durable Object, the web app from assets), `apps/server/scripts/smoke.ts` passes against it including an idle gap, and `wrangler deploy --dry-run` bundles. `smoke.ts` now makes its own throwaway account.
- Also done in this pass: the main bundle is code-split (editor, settings, import and public pages load on demand; the entry chunk fell from 2.1 MB to under 100 kB), and the Playwright two-device test (`e2e/sync.e2e.ts`, `bun run test:e2e`).

## Next phases (planned 2026-11-19)

From an audit of every mockup board against `apps/web/src`, plus the disabled Settings rows, the "Later" list and the "Not yet" notes above. Same rules: start a phase only on the user's go-ahead, stop after each, match the boards. A feature with no board gets a "draw the board, get the user's OK" step first. Trash, History, Share, Public-Page, Sync-States and Home match their boards; Sign-In, Setup and Recovery differ on purpose (phrase instead of codes).

12. **New note with a type, bulk delete and a clearer page menu** (agreed and built 2026-11-19). Today `useNewPage` makes a blank top-level "Untitled" page, the sidebar row menu says "Indent" / "Outdent", and pages can only be trashed one at a time.
    - **Boards first** (mockup https://claude.ai/artifact/2oncbwyZeMDyVdZkDGwNJQ), then stop for the user's OK before building:
      - [x] Sidebar · Select (checkboxes on rows, bottom bar "N selected · Move to trash · Cancel", phone drawer version)
      - [x] Trash · Select (checkboxes, "Restore N" and "Delete N forever", the confirmation "Delete N pages forever? This can't be undone.")
      - [x] Today · Still to do (a quiet section under today's title listing unchecked to-dos, each with its page name as a link)
    - **Clearer page menu** (`Sidebar.tsx`, `RowMenu`):
      - [x] Words for everyone: "Add a page inside", "Move up", "Move down", "Put inside "<page above>"", "Move out of "<parent>"", a divider, "Move to trash"; long titles are cut with an ellipsis, empty ones read "Untitled"
      - [x] Items that cannot apply are hidden (Move up / Put inside on the first page, Move down on the last, Move out of on a top-level page), using `siblingsOf`; `nudgeNote` is unchanged
      - [x] New item "Select pages" starts Select mode with this row ticked; `aria-label`s match the words
    - **Bulk delete**:
      - [x] `components/useSelection.ts`: the selected set, an anchor for Shift ranges, toggle / range / clear; unit test for the range logic
      - [x] Sidebar: Select mode (checkboxes, 44 px targets on touch), Ctrl/Cmd-click ticks a row, Shift-click ticks the range in visible order, a plain click toggles while selecting, drag-reorder off while selecting, Esc or Cancel leaves
      - [x] Sidebar bar: "Move to trash" trashes every selected page in one `workspace.index` transaction (a ticked page under a ticked parent is skipped); go Home if the open page was trashed
      - [x] Trash page: "Select" and "Select all", Ctrl/Cmd and Shift-click, "Restore N" (one transaction), "Delete N forever" with the confirmation, reusing the existing purge and server cleanup
    - **New note with a type** (board "Desktop · New note"):
      - [x] `NoteMeta.kind` and `CreateNoteInput.kind` (`quick`, `page`, `checklist`, `journal`, `meeting`, `study`) in `packages/sync/src/workspace.ts`; a missing kind means page; tests
      - [x] `ensureJournalEntry(doc, date)`: a deterministic "Journal" parent and an entry `journal-YYYY-MM-DD`, so two offline devices converge on one entry per day; separate from Today's daily note; tests
      - [x] `components/NewNoteDialog.tsx`: "What are you writing?", six cards with the board's icons and copy, keys 1–6, arrow keys, Enter creates, Esc / Cancel closes, "Create {type}", radiogroup semantics, full-height sheet on phones
      - [x] "Save in" picker (indented page list plus "Top level"; default the open page's parent); Journal always files under Journal
      - [x] `editor/templates.ts`, written with `withFragment`: Quick note (cursor in the body; an untitled note takes its first line as the title), Page (blank), Checklist (three empty to-dos), Meeting notes (who was there / what was said / what happens next), Study note (summary callout, maths, code, questions in a toggle)
      - [x] `useNewPage(parentId, kind)` is the one place that creates, fills and opens a note; the sidebar +, Ctrl/Cmd+N and the phone drawer + open the dialog; "Add a page inside" still makes a plain page at once
      - [x] Today · Still to do: on a daily note, unchecked to-dos from non-trashed Checklist notes, read on the device (`withFragment` + `fragmentBlocks`), refreshed as they change; ticking one updates the checklist; nothing goes to the server
    - **Checks**:
      - [x] `bun test`, `bun run typecheck`, `bun run lint`
      - [x] Browser check against each board in light, dark and at 375 px: menu words and hidden items; select 3 pages by mode, Ctrl-click and Shift-click, trash them, restore and delete forever from Trash; a parent and child ticked together; all six note types; a journal entry twice in one day opens the same entry; a checklist's unchecked items show on Today
      - [x] `bun run test:e2e`: a bulk trash and a new journal entry reach the second device
      - [x] Update this file and the "Built so far" line in `CLAUDE.md`
    - Notes on how it came out: boards were added to the mockup first (Select pages desktop and phone, Sidebar select component, Trash select, Delete forever confirm, Today still to do). Select mode ticks with a checkbox on any device; Ctrl/Cmd-click or Shift-click on a row starts it. In Trash, "Delete N forever" asks first in a dialog (single "Delete forever" and "Empty trash" still use the browser confirm). A daily note is no longer counted as "the page above" by Put inside and Move up (it sits at the top level but lives behind Today, so the first page used to move into an invisible note). Journal ids needed `parsePageSlug` to know `journal-YYYY-MM-DD`. "Save in" starts at the open page's parent, so a note made while a journal entry is open lands in Journal unless you change it. Ticking a to-do on Today opens that checklist for editing so the change syncs. A new quick note opens in its body; if untitled, its first line becomes its title when you leave. The e2e test now waits for the service worker before going offline (it raced the install) and has a journal and bulk-trash test.
    - Not yet: "You can change it later" on the picker is only true in the sense that the content is editable (the kind cannot be changed after creation); the single "Delete forever" and "Empty trash" confirms are still browser dialogs; Today's list reads the checklists you can see in the tree, not ones in the trash.
13. **Mockup gaps on existing screens**
    - [x] Phone header (Phone-Light): menu icon, parent breadcrumb, sync status and a More menu with Version history, Share, Export and Trash (done 2026-11-19; checked at 375 px in the browser pane; the Logo and wordmark left the phone header, as on the board)
    - [ ] Sidebar: open/closed folder icons for parents, page icon for leaves, instead of the chevron
    - [ ] Slash menu (Blocks): one "Blocks" group in the board's order (Text, Heading, To-do list, Bulleted list, Toggle, Quote, Code, Math, Table, Callout), Markdown hints, footer "Type to filter · ↑ ↓ move · Enter insert · Esc close"; other blocks still found by typing
    - [ ] Switcher: "N of M matches"; "Ctrl Enter open beside" needs split view (decision: build it or drop the hint)
    - [ ] Quick capture: "Add to Today ▾" becomes a real picker (Today / new note / a page), shared with Settings → "Add captures to"
    - [ ] Import progress: "N images saved" copy
    - [ ] Desktop: frameless main window with the board's minimise / maximise / close and a drag region (macOS keeps traffic lights)
    - [ ] Ctrl+Shift+F opens a "search all pages" mode, not the same view as Ctrl+K
    - [ ] Check and document that Ctrl+N and Ctrl+Shift+T only work in the desktop app and the PWA (browsers take them in a tab)
14. **Settings rows that only need the device**
    - [ ] Workspace name: in the index doc (synced, sealed), shown in the sidebar and on shared pages
    - [ ] Open on start: Home, Today or the last page (`LAST_NOTE_KEY`)
    - [ ] Spellcheck; smart punctuation and auto-pair (input rules); paste behaviour (keep formatting / plain text)
    - [ ] Public pages / Manage links: list shared pages with Open, Copy, Stop sharing and the count; drop the stale "Arrives with sharing" note
    - [ ] Clear cache: size from `navigator.storage.estimate()`, refused while edits or uploads are waiting
    - [ ] Lock after inactivity: idle timer forgets the key and shows Unlock; copy says passkey/phrase, not password/Face ID
    - [ ] About: What's new, Get the apps, Privacy, Open-source licences
    - [ ] Language (decision: real i18n, or English only)
    - [ ] Boards first for Manage links and the lock screen if Unlock does not fit
15. **Desktop-only settings (Tauri)**
    - [ ] Keep capture window on top (hard-coded today), Launch at login (autostart plugin), Keep running in the tray (close hides vs quits); shown only in the desktop app, stored in the app config dir
16. **Delete account and server cleanup**
    - [ ] Board first: confirmation (phrase or passkey, "Export first")
    - [ ] Endpoint on both runtimes: Better Auth rows, `key_wrap`, `doc_version`, `share_link`, `doc_log` / Durable Object storage, all blobs; tests in `auth.test.ts`
    - [ ] Client: sign out and offer to wipe this device
    - [ ] Delete forever also removes the note's log on the server
17. **[[Wiki links]] and backlinks**
    - [ ] Boards first: `[[` picker, link look, "Linked from" under the note
    - [ ] Inline page-link content storing the note id (renames never break it)
    - [ ] Backlink index on the device beside search, never on the server
    - [ ] Obsidian `[[links]]` and Notion page links import as real links; export writes relative Markdown links
18. **Known gaps and debt**
    - [ ] "N waiting to upload" in the sync status
    - [ ] Share links: optional expiry; "last updated" on the public page
    - [ ] Per-account quotas for files, snapshots and shares
    - [ ] Server cache for unfurl answers; close the DNS-rebinding gap on self-host
    - [ ] Importers: Notion CSV databases, Obsidian canvas, Keep audio transcripts; re-import a Seijaku export zip
    - [ ] "When two edits collide" (decision: remove the row or rework it; Yjs merges, so there is no older version to keep)
19. **Databases**
    - [ ] Spike and boards first: table view of child pages with typed properties (text, select, date, checkbox), sort, filter; properties in the index doc. Build only after the boards and data model are approved
20. **Collaborative sharing**
    - [ ] Key design first (wrap a page key per recipient account), approved before boards
    - [ ] Boards: invite, people with access, read or edit, revoke; revoking rotates the page key (limit stated plainly)

With every phase: update this file and the "Built so far" line in `CLAUDE.md`; browser check against the board (light, dark, phone); `bun run typecheck`, `bun run lint`, `bun test`, and `bun run test:e2e` when sync or sharing changes.

### Left for you

These need your accounts or devices and cannot be done from this machine:

- A real Cloudflare deploy (`wrangler login`, create D1 and R2, `bun run --cwd apps/server deploy`), then repeat the two-device test against it.
- `docker compose up` on a Docker host (Docker is not installed here; the same server and web build run in the Playwright test).
- Install the PWA on an iPhone from Safari; test offline editing, the formatting bar above the keyboard, and passkey sign-in.
- Push a `v*` tag with the `TAURI_SIGNING_PRIVATE_KEY` secret set, so GitHub Actions builds the macOS and Linux apps and the first signed update.
- Real Apple Notes and Journal exports, to replace the folder-based importers with proper ones.

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
