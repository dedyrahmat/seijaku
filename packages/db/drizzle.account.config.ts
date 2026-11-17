import { defineConfig } from "drizzle-kit";

/** Migrations for the account tables (Bun database file and Cloudflare D1). */
export default defineConfig({
	dialect: "sqlite",
	schema: "./src/schema/account.ts",
	out: "./drizzle/account",
});
