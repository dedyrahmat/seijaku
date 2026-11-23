import { useSyncExternalStore } from "react";

/** Per-device preferences from the Settings board. Stored in localStorage, applied to <html>. */

/** "seijaku" is the hand-drawn default; the rest come from Iconify packs (see components/Icon.tsx). */
export const ICON_PACKS = [
	"seijaku",
	"lucide",
	"iconoir",
	"remix",
	"solar",
] as const;
export type IconPack = (typeof ICON_PACKS)[number];

export interface Prefs {
	theme: "light" | "dark" | "system";
	accent: "vermilion" | "matcha" | "indigo" | "gold" | "ink";
	textSize: number;
	pageWidth: "narrow" | "comfortable" | "wide";
	lineSpacing: "tight" | "relaxed" | "airy";
	headingFont: "Newsreader" | "Hanken Grotesk";
	codeFont: "JetBrains Mono" | "System mono";
	reduceMotion: boolean;
	workOffline: boolean;
	markdownShortcuts: boolean;
	smartPunctuation: boolean;
	spellcheck: boolean;
	autoPair: boolean;
	blockHandles: boolean;
	renderMath: boolean;
	/** A language code from `i18n/index.ts`; anything unknown (like the old "English") falls back to English there. */
	language: string;
	iconPack: IconPack;
	openOnStart: "Today" | "Last page" | "Home";
	trashAfter: "After 7 days" | "After 30 days" | "Never";
	historyFor: "30 days" | "90 days" | "Forever";
	lockAfterIdle: "5 minutes" | "15 minutes" | "Never";
	pasteStyle: "Match page style" | "Plain text";
	/** "today", "new" (a quick note) or "page:<id>". */
	captureTo: string;
}

export const DEFAULTS: Prefs = {
	theme: "system",
	accent: "vermilion",
	textSize: 17,
	pageWidth: "comfortable",
	lineSpacing: "relaxed",
	headingFont: "Newsreader",
	codeFont: "JetBrains Mono",
	reduceMotion: false,
	workOffline: false,
	markdownShortcuts: true,
	smartPunctuation: true,
	spellcheck: true,
	autoPair: false,
	blockHandles: true,
	renderMath: true,
	language: "en",
	iconPack: "seijaku",
	openOnStart: "Today",
	trashAfter: "After 30 days",
	historyFor: "90 days",
	lockAfterIdle: "Never",
	pasteStyle: "Match page style",
	captureTo: "today",
};

function readLocal(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function writeLocal(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		// Storage unavailable: the preference will not persist.
	}
}

const KEY = "seijaku:prefs";
const query = "(prefers-color-scheme: dark)";

export const ACCENTS: Record<
	Prefs["accent"],
	{ label: string; light: string; dark: string }
> = {
	vermilion: { label: "Vermilion", light: "#ae3b28", dark: "#e27a63" },
	matcha: { label: "Matcha", light: "#6f8f63", dark: "#6f8f63" },
	indigo: { label: "Indigo", light: "#5b73a3", dark: "#5b73a3" },
	gold: { label: "Gold", light: "#c9a04a", dark: "#c9a04a" },
	ink: { label: "Ink", light: "#201d19", dark: "#e9e3d6" },
};

const WIDTHS = { narrow: "680px", comfortable: "760px", wide: "920px" };
const LINES = { tight: "1.55", relaxed: "1.75", airy: "2" };

function load(): Prefs {
	try {
		const raw = readLocal(KEY);
		return { ...DEFAULTS, ...(raw ? (JSON.parse(raw) as Partial<Prefs>) : {}) };
	} catch {
		return DEFAULTS;
	}
}

let current: Prefs = load();
const listeners = new Set<() => void>();

export function resolvedTheme(p: Prefs = current): "light" | "dark" {
	if (p.theme !== "system") return p.theme;
	return window.matchMedia(query).matches ? "dark" : "light";
}

/** Writes the preferences onto <html> so plain CSS can react to them. */
export function applyPrefs(p: Prefs = current): void {
	const root = document.documentElement;
	const theme = resolvedTheme(p);
	root.dataset.theme = theme;
	const accent = ACCENTS[p.accent][theme];
	root.style.setProperty("--accent", accent);
	root.style.setProperty("--accent-soft", `${accent}26`);
	root.style.setProperty("--text-size", `${p.textSize / 16}rem`);
	root.style.setProperty("--page-width", WIDTHS[p.pageWidth]);
	root.style.setProperty("--line-height", LINES[p.lineSpacing]);
	root.style.setProperty(
		"--font-heading",
		p.headingFont === "Newsreader" ? "var(--font-serif)" : "var(--font-sans)",
	);
	root.style.setProperty(
		"--font-code",
		p.codeFont === "JetBrains Mono"
			? "var(--font-mono)"
			: "ui-monospace, Menlo, Consolas, monospace",
	);
	root.dataset.reduceMotion = String(p.reduceMotion);
	root.dataset.blockHandles = String(p.blockHandles);
}

export function getPrefs(): Prefs {
	return current;
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
	current = { ...current, [key]: value };
	writeLocal(KEY, JSON.stringify(current));
	applyPrefs();
	for (const l of listeners) l();
}

export function subscribe(l: () => void): () => void {
	listeners.add(l);
	return () => listeners.delete(l);
}

export function usePrefs(): Prefs {
	return useSyncExternalStore(subscribe, getPrefs);
}

/** Call once at start-up: applies the saved look and follows the system theme while on "System". */
export function initPrefs(): void {
	applyPrefs();
	window.matchMedia(query).addEventListener("change", () => {
		if (current.theme === "system") {
			applyPrefs();
			for (const l of listeners) l();
		}
	});
}

/** The theme in effect right now; re-renders when the user or the system changes it. */
export function useResolvedTheme(): "light" | "dark" {
	return useSyncExternalStore(subscribe, () => resolvedTheme());
}
