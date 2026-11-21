export const TINTS = [
	"washi",
	"kaki",
	"matcha",
	"ai",
	"sakura",
	"kuchiba",
] as const;
export type Tint = (typeof TINTS)[number];

/** CSS value for a tint name (unknown or missing falls back to washi). */
export const tintVar = (t: unknown) =>
	`var(--tint-${TINTS.includes(t as Tint) ? t : "washi"})`;
