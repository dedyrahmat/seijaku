/** `2026-11-19` in local time, the form the date fields and the to-do lists compare on. */
export const isoDay = (d: Date) => {
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
