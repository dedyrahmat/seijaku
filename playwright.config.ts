import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

const dir = mkdtempSync(join(tmpdir(), "seijaku-e2e-"));
const port = 8792;

// Runs against the Bun server serving the built web app (`bun run --cwd apps/web build` first).
// Uses the Chrome installed on the machine: no browser download. Set E2E_CHANNEL=msedge for Edge.
export default defineConfig({
	testDir: "e2e",
	testMatch: "**/*.e2e.ts",
	timeout: 90_000,
	workers: 1,
	use: {
		baseURL: `http://localhost:${port}`,
		channel: process.env.E2E_CHANNEL ?? "chrome",
	},
	webServer: {
		command: "bun apps/server/src/bun.ts",
		url: `http://localhost:${port}/api/health`,
		reuseExistingServer: false,
		env: {
			PORT: String(port),
			SEIJAKU_ORIGIN: `http://localhost:${port}`,
			SEIJAKU_DB: join(dir, "seijaku.sqlite"),
			SEIJAKU_BLOBS: join(dir, "blobs"),
			SEIJAKU_WEB: "apps/web/dist",
			SETUP_TOKEN: "",
			// The e2e helpers give each browser context its own address this way.
			SEIJAKU_IP_HEADER: "x-forwarded-for",
		},
	},
});
