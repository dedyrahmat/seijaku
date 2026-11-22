import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { getPrefs, subscribe } from "../preferences";
import en from "./en.json";
import id from "./id.json";

/** Add a language here and in `resources`; every file must have the same shape as `en`. */
export const LANGUAGES = ["en", "id"] as const;
export type Language = (typeof LANGUAGES)[number];

export function languageOf(value: unknown): Language {
	return LANGUAGES.find((l) => l === value) ?? "en";
}

export const i18n = i18next.createInstance();

void i18n.use(initReactI18next).init({
	resources: { en: { translation: en }, id: { translation: id } },
	lng: languageOf(getPrefs().language),
	fallbackLng: "en",
	interpolation: { escapeValue: false }, // React already escapes
	initAsync: false,
});

/** Follow the language preference; keeps `<html lang>` in step for screen readers and spellcheck. */
export function initI18n(): void {
	const apply = () => {
		const lang = languageOf(getPrefs().language);
		document.documentElement.lang = lang;
		if (i18n.language !== lang) void i18n.changeLanguage(lang);
	};
	apply();
	subscribe(apply);
}

/** The locale for dates and times: English keeps the 24-hour, day-first look the design uses. */
export function dateLocale(): string {
	return i18n.language === "en" ? "en-GB" : i18n.language;
}
