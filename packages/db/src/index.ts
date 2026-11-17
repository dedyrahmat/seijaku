export { accountMigrations, logMigrations } from "./migrations";
export * from "./schema/account";
export * from "./schema/log";

/** A migration set as drizzle's journal form, for drivers that take one (bun:sqlite). */
export function journalOf(migrations: Record<string, string>) {
	return Object.keys(migrations)
		.sort()
		.map((name) => {
			const m = name.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
			if (!m) throw new Error(`Bad migration name: ${name}`);
			const [, y, mo, d, h, mi, s] = m.map(Number);
			return {
				name,
				sql: migrations[name] as string,
				timestamp: Date.UTC(y as number, (mo as number) - 1, d, h, mi, s),
			};
		});
}
