# Contributing

Seijaku is a personal project, but issues and pull requests are welcome.

## Setup

```bash
bun install
bun run --cwd apps/web dev
```

## Before opening a pull request

```bash
bun run typecheck
bun run lint
bun test
bun run test:e2e   # needs Chrome; builds the web app first
```

Changes to the editor or sidebar also need a manual check in a browser; there are no web app tests yet.

Read [docs/PLAN.md](docs/PLAN.md) first. It defines the scope, the architecture and the phase order, and new work should fit it.
