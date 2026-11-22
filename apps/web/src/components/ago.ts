import { i18n } from "../i18n";

/** "just now", "2 minutes ago": how the design words elapsed time. */
export function ago(then: number | null, now: number): string {
	if (!then) return i18n.t("ago.justNow");
	const mins = Math.floor((now - then) / 60_000);
	if (mins < 1) return i18n.t("ago.justNow");
	if (mins < 60) return i18n.t("ago.minutes", { count: mins });
	const hours = Math.floor(mins / 60);
	if (hours < 24) return i18n.t("ago.hours", { count: hours });
	const days = Math.floor(hours / 24);
	return days === 1
		? i18n.t("ago.yesterday")
		: i18n.t("ago.days", { count: days });
}
