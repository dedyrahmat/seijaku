# Seijaku 静寂

**Active calm. The opposite of noise.**

Seijaku is a local-first, end-to-end encrypted note-taking app. The name is the Japanese Zen garden idea of stillness: as capable as Notion or Obsidian, with an interface that never shouts.

It runs in the browser, installs as an app on iPhone and Android (PWA), and ships as a desktop app for Windows, macOS and Linux. You host the server yourself, on one Docker container or on Cloudflare.

## Features

- **Pages and organising:** nested pages with drag-and-drop (and a row menu for keyboard and touch), tags, daily notes and a journal, `[[page links]]` with backlinks, trash with auto-empty, on-device search and a quick switcher (Ctrl/Cmd+K).
- **Editor:** blocks with Markdown shortcuts and a slash menu: headings, lists, to-dos with due dates, quotes, code, tables, toggles, callouts, math (KaTeX), images, video, audio, files and link previews.
- **Note types:** page, checklist, journal entry, meeting notes, study note, quick note and database (a table of pages with typed properties, sort and filter).
- **Local-first:** every note is saved on your device first and works offline, then syncs to your server. Edits made offline on several devices merge cleanly.
- **Private by design:** notes are encrypted on your devices. The server only stores sealed data and cannot read titles, text or files.
- **Accounts:** sign in with a passkey or a 12-word recovery phrase. Signing in is optional; without an account your notes stay on the device.
- **Sharing:** revocable, expiring public read-only links, and sharing a page with other accounts as editor or reader.
- **History:** version snapshots with preview and restore.
- **Import and export:** Obsidian, Notion, Google Keep, Evernote, Apple Notes, Apple Journal, Markdown, HTML and text in; a zip of Markdown files out.
- **Desktop extras:** a global quick-capture hotkey, tray icon, launch at login and auto-update.
- **Languages:** English and Indonesian.
- **Design:** "Washi & ink": a warm paper light theme and a sumi-ink dark theme that follows your system.

## Tech stack

| Area                | Technology                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime and tooling | [Bun](https://bun.sh) workspaces (package manager, test runner, self-host runtime), TypeScript, [Biome](https://biomejs.dev)                      |
| Web app             | React 19, [Vite](https://vite.dev), [TanStack Router](https://tanstack.com/router), Tailwind CSS v4, i18next, KaTeX                               |
| Editor              | [BlockNote](https://www.blocknotejs.org) (core MPL packages only) on ProseMirror                                                                  |
| Notes and sync      | [Yjs](https://yjs.dev) CRDTs, `y-indexeddb` for on-device storage, one WebSocket per device                                                       |
| Encryption          | `@noble/ciphers`, `@noble/curves`, `@noble/hashes`, `@scure/bip39` (recovery phrase), WebAuthn PRF for passkey-derived keys                       |
| Server              | [Hono](https://hono.dev), [Better Auth](https://www.better-auth.com) with passkeys, [Drizzle ORM](https://orm.drizzle.team) (SQLite dialect), Zod |
| Hosting target 1    | Bun (`Bun.serve`, `bun:sqlite`, files on disk), one Docker container                                                                              |
| Hosting target 2    | Cloudflare Workers, Durable Objects (WebSocket hibernation), D1, R2                                                                               |
| PWA                 | `vite-plugin-pwa` and Workbox (installable, offline shell)                                                                                        |
| Desktop             | [Tauri 2](https://tauri.app) (Rust): tray, global shortcut, deep links, OS keychain, updater                                                      |
| Tests and CI        | `bun:test`, [Playwright](https://playwright.dev) end-to-end, GitHub Actions                                                                       |

## Getting started (development)

You need [Bun](https://bun.sh). The desktop app also needs Rust and, on Windows, the MSVC build tools.

```bash
bun install
bun run --cwd apps/server dev   # sync server on http://localhost:8791
bun run --cwd apps/web dev      # web app on http://localhost:5173
```

Open http://localhost:5173. Vite proxies `/api` and `/sync` to the server on port 8791. The web app alone is enough to write notes; the server adds accounts and sync. If the app says it cannot reach the server, check that nothing else is using port 8791.

To test two devices in one browser, open the app on two origins (`localhost` and `[::1]`): each has its own IndexedDB.

### Commands

```bash
bun run typecheck                     # tsc --noEmit in every package
bun run lint                          # biome check
bun run format                        # biome format --write
bun test                              # unit and server tests
bun run test:e2e                      # Playwright end-to-end (builds the web app; needs Chrome)
bun run --cwd apps/web build          # production web build into apps/web/dist
bun run --cwd apps/server dev:worker  # the Cloudflare build of the server, locally on workerd
bun run --cwd apps/desktop dev        # desktop app in development
```

`E2E_CHANNEL=msedge bun run test:e2e` runs the end-to-end tests in Edge instead of Chrome.

## Using Seijaku

1. **Open the app.** You can start writing straight away; notes are stored on this device.
2. **Create an account (optional).** Choose a passkey, or generate a 12-word recovery phrase and write it down. The phrase is the only way to restore your notes on a new device if you lose every signed-in device, and nobody can recover it for you.
3. **Sign in on another device.** Use your passkey or the phrase. Your notes download, decrypted on the device.
4. **Write.** `+` in the sidebar creates a page (pick a note type). Type `/` for blocks. Ctrl/Cmd+K jumps to a page; Ctrl/Cmd+Shift+F searches the text of every page.
5. **Organise.** Drag pages in the sidebar, or use a row's `⋯` menu to move, nest or trash it. Deleted pages wait in Trash.
6. **Share.** Use Share in the title bar for a public read-only link, or invite another account to a page.
7. **Bring notes in or take them out** under Settings, Data and storage.
8. **Install it.** In a browser use "Install app" (on iPhone, Share, then Add to Home Screen), or install the desktop app.

Quick capture (desktop): press Ctrl/Cmd+Alt+Space anywhere to jot a line into today's note. You can rebind the key in Settings.

## Deploy

Both targets run the same code. Static-only hosts such as Vercel cannot run the server: it needs a long-lived WebSocket and a database.

Passkeys need HTTPS and a stable address, so set the public address before you start.

### Option 1: self-host with Docker (one container)

Bun serves the API, the sync socket and the web app. Notes, files and the database live in a volume at `/data`.

```bash
SEIJAKU_ORIGIN=https://notes.example.com docker compose up -d
```

Put a reverse proxy with HTTPS (Caddy, nginx, Traefik) in front of port 8791. The same Dockerfile works on a VPS, Railway, Fly and Render; give it a volume at `/data`.

Without Docker: `bun install`, `bun run --cwd apps/web build`, then `bun apps/server/src/bun.ts`.

| Variable                                            | Purpose                                                                                                       | Default                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `SEIJAKU_ORIGIN`                                    | Public address(es) people open the app at, comma-separated. Required for passkeys.                            | `http://localhost:8791` in compose |
| `SETUP_TOKEN`                                       | Sign-up code every new account must enter. Unset means anyone who can reach the server can create an account. | unset                              |
| `PORT`                                              | Port to listen on                                                                                             | `8791`                             |
| `SEIJAKU_DB`                                        | SQLite file                                                                                                   | `/data/seijaku.sqlite` in Docker   |
| `SEIJAKU_BLOBS`                                     | Folder for attached files                                                                                     | `/data/blobs` in Docker            |
| `SEIJAKU_WEB`                                       | Folder with the web build                                                                                     | `apps/web/dist`                    |
| `SEIJAKU_RP_ID`                                     | WebAuthn relying-party id, if it must differ from the origin's host                                           | derived from the origin            |
| `AUTH_SECRET`                                       | Session signing secret                                                                                        | generated and kept in the database |
| `QUOTA_FILES_MB`, `QUOTA_SNAPSHOTS`, `QUOTA_SHARES` | Per-account limits on files, history snapshots and share links                                                | built-in defaults                  |

Back up the `/data` volume. Because notes are encrypted on the device, a backup of it cannot be read without the account keys.

### Option 2: Cloudflare (Workers, Durable Objects, D1, R2)

```bash
bunx wrangler login
cd apps/server
bunx wrangler d1 create seijaku           # put the printed database_id into wrangler.jsonc
bunx wrangler r2 bucket create seijaku-files
cd ../.. && bun run --cwd apps/web build
bun run --cwd apps/server deploy
```

The Worker serves the web app too, and keeps one Durable Object per account. Account tables are created in D1 by the Worker on its first request, so there is no separate migration step. The Worker uses the address it is opened at for passkeys; set `SEIJAKU_ORIGIN` under `vars` in `apps/server/wrangler.jsonc` (comma-separated) if you serve it from several. For a sign-up code run `bunx wrangler secret put SETUP_TOKEN`.

### Desktop app

Pushing a tag like `v0.1.0` builds Windows, macOS and Linux installers on GitHub Actions into a draft release. Add the updater private key as the repository secret `TAURI_SIGNING_PRIVATE_KEY` (its public half is in `apps/desktop/src-tauri/tauri.conf.json`). In the app, set your server address under Settings, Sync and devices, then sign in. Sign-in opens your system browser and returns through a `seijaku://` link.

To build locally: `bun run --cwd apps/desktop build` (installers land in `apps/desktop/src-tauri/target/release/bundle`).

## Repository layout

```
apps/web        Vite + React app (TanStack Router, Tailwind v4, BlockNote), also the PWA
apps/desktop    Tauri 2 shell (Rust): tray, capture hotkey, keychain, updater
apps/server     Hono server with two entry points: bun.ts (self-host) and worker.ts (Cloudflare)
packages/sync   Yjs workspace model, sync protocol and encryption
packages/db     Drizzle schema and migrations
e2e/            Playwright end-to-end tests
docs/           PLAN.md (scope and architecture), TRANSLATING.md, COLLABORATIVE-SHARING.md
```

## Status

All planned phases are built. What still needs a real environment: a live Cloudflare deploy, an install on a real iPhone, and macOS and Linux desktop builds on CI. The Apple Notes and Apple Journal importers read folders of HTML, Markdown or text, because their real export formats are unconfirmed. The full plan and phase history are in [docs/PLAN.md](docs/PLAN.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To add a language, see [docs/TRANSLATING.md](docs/TRANSLATING.md).

## License

[MIT](LICENSE)
