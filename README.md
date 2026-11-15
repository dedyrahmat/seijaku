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
