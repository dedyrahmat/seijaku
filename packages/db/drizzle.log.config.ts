import { defineConfig } from "drizzle-kit";

/** Migrations for the sync log (Bun database file and each Durable Object). */
export default defineConfig({
	dialect: "sqlite",
	schema: "./src/schema/log.ts",
	out: "./drizzle/log",
});
