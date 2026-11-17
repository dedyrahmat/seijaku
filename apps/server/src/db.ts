import type { SQLiteAsyncDatabase } from "drizzle-orm/sqlite-core";

/**
 * The two kinds of database the server talks to, whichever driver is behind them: the sync log
 * is always synchronous (bun:sqlite, a Durable Object's SQLite); the account tables may be
 * asynchronous (D1). Code awaits every query, so one version serves both.
 */
// biome-ignore lint/suspicious/noExplicitAny: the driver's result and relation types differ and do not matter here
export type LogDb = SQLiteAsyncDatabase<"sync", any, any>;
// biome-ignore lint/suspicious/noExplicitAny: as above
export type AccountDb = SQLiteAsyncDatabase<"sync" | "async", any, any>;
