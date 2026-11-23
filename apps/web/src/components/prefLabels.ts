import { useTranslation } from "react-i18next";

/** Preferences are stored as their English words; this gives each one its translated text for a Select. */
export function usePrefLabels() {
	const { t } = useTranslation();
	return {
		openOnStart: {
			Today: t("prefs.openOnStart.Today"),
			"Last page": t("prefs.openOnStart.Last page"),
			Home: t("prefs.openOnStart.Home"),
		},
		pasteStyle: {
			"Match page style": t("prefs.pasteStyle.Match page style"),
			"Plain text": t("prefs.pasteStyle.Plain text"),
		},
		trashAfter: {
			"After 7 days": t("prefs.trashAfter.After 7 days"),
			"After 30 days": t("prefs.trashAfter.After 30 days"),
			Never: t("prefs.trashAfter.Never"),
		},
		historyFor: {
			"30 days": t("prefs.historyFor.30 days"),
			"90 days": t("prefs.historyFor.90 days"),
			Forever: t("prefs.historyFor.Forever"),
		},
		lockAfterIdle: {
			"5 minutes": t("prefs.lockAfterIdle.5 minutes"),
			"15 minutes": t("prefs.lockAfterIdle.15 minutes"),
			Never: t("prefs.lockAfterIdle.Never"),
		},
		codeFont: {
			"JetBrains Mono": t("prefs.codeFont.JetBrains Mono"),
			"System mono": t("prefs.codeFont.System mono"),
		},
	};
}
