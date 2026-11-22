import { useTranslation } from "react-i18next";
import { ICON_PACKS, setPref, usePrefs } from "../preferences";
import { Icon, type IconName } from "./Icon";

const PREVIEW: IconName[] = ["home", "pin", "today", "share", "search"];
const NAMES = {
	lucide: "Lucide",
	iconoir: "Iconoir",
	remix: "Remix",
	solar: "Solar",
};

/** Settings → Appearance: one card per icon pack, each drawn in its own style. */
export function IconPackPicker() {
	const { t } = useTranslation();
	const current = usePrefs().iconPack;
	return (
		// biome-ignore lint/a11y/useSemanticElements: a grid of toggle cards, not a form group
		<div
			role="group"
			aria-label={t("settings.appearance.icons.label")}
			className="grid grid-cols-2 gap-x-4 gap-y-3.5 py-3.5 sm:grid-cols-3"
		>
			{ICON_PACKS.map((pack) => {
				const on = pack === current;
				return (
					<div key={pack} className="flex flex-col items-center gap-2">
						<button
							type="button"
							aria-pressed={on}
							aria-label={
								pack === "seijaku"
									? t("settings.appearance.icons.seijaku")
									: NAMES[pack]
							}
							onClick={() => setPref("iconPack", pack)}
							className={`flex h-[60px] w-full items-center justify-center gap-3.5 rounded-full border bg-raised text-ink ${on ? "border-ink shadow-[0_0_0_1px_var(--ink)]" : "border-line hover:border-mute"}`}
						>
							{PREVIEW.map((name) => (
								<Icon key={name} name={name} pack={pack} size={16} />
							))}
						</button>
						<span
							className={`text-sm ${on ? "font-semibold text-ink" : "text-mute"}`}
						>
							{pack === "seijaku"
								? t("settings.appearance.icons.seijaku")
								: NAMES[pack]}
						</span>
					</div>
				);
			})}
		</div>
	);
}
