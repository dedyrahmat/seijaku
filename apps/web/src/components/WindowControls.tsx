import { useTranslation } from "react-i18next";
import { isDesktop, isMacDesktop, windowAction } from "../desktop";

const btn =
	"flex h-10 w-[46px] items-center justify-center text-ink2 hover:bg-hover";

/** Minimise, maximise and close for the frameless desktop window (Windows and Linux). */
export function WindowControls() {
	const { t } = useTranslation();
	if (!isDesktop || isMacDesktop) return null;
	return (
		<div className="ml-2 flex h-10 flex-none">
			<button
				type="button"
				aria-label={t("window.minimise")}
				onClick={() => void windowAction("minimize")}
				className={btn}
			>
				<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
					<path d="M2 6h8" stroke="currentColor" strokeWidth="1.2" />
				</svg>
			</button>
			<button
				type="button"
				aria-label={t("window.maximise")}
				onClick={() => void windowAction("toggleMaximize")}
				className={btn}
			>
				<svg
					width="12"
					height="12"
					viewBox="0 0 12 12"
					fill="none"
					aria-hidden="true"
				>
					<rect
						x="2"
						y="2"
						width="8"
						height="8"
						stroke="currentColor"
						strokeWidth="1.2"
					/>
				</svg>
			</button>
			<button
				type="button"
				aria-label={t("common.close")}
				onClick={() => void windowAction("close")}
				className={`${btn} hover:bg-accent hover:text-paper`}
			>
				<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
					<path
						d="M2.5 2.5l7 7M9.5 2.5l-7 7"
						stroke="currentColor"
						strokeWidth="1.2"
					/>
				</svg>
			</button>
		</div>
	);
}
