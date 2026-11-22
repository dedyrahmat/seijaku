import { useState } from "react";
import { useTranslation } from "react-i18next";
import { isDesktop } from "../desktop";
import { LICENCES } from "../licences";
import { Modal } from "./DeviceSettings";
import { Btn, Row } from "./SettingRows";

/** Settings → About: plain-language pages for What's new, Get the apps, Privacy and Licences. */

export const REPO = "https://github.com/dedyrahmat/seijaku";

const RELEASES = [
	{
		version: "0.1.0",
		date: "about.news.date",
		notes: [
			"about.news.n1",
			"about.news.n2",
			"about.news.n3",
			"about.news.n4",
			"about.news.n5",
		],
	},
] as const;

type Doc = "news" | "apps" | "privacy" | "licences";

const TITLES = {
	news: "about.titles.news",
	apps: "about.titles.apps",
	privacy: "about.titles.privacy",
	licences: "about.titles.licences",
} as const;

function Para({ children }: { children: React.ReactNode }) {
	return (
		<p className="px-[22px] pt-3.5 text-sm leading-relaxed text-ink2">
			{children}
		</p>
	);
}

/** A paragraph that opens with a bold lead-in, both from the messages. */
function Lead({ lead, children }: { lead: string; children: React.ReactNode }) {
	return (
		<Para>
			<b className="font-medium text-ink">{lead}</b> {children}
		</Para>
	);
}

const LINK = "underline underline-offset-[3px]";

function Body({ doc }: { doc: Doc }) {
	const { t } = useTranslation();
	if (doc === "news")
		return (
			<div className="pb-4">
				{RELEASES.map((r) => (
					<section key={r.version} className="px-[22px] pt-4">
						<h3 className="text-sm font-semibold">
							{t("about.news.version", { version: r.version })}{" "}
							<span className="font-normal text-mute">· {t(r.date)}</span>
						</h3>
						<ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-ink2">
							{r.notes.map((n) => (
								<li key={n}>{t(n)}</li>
							))}
						</ul>
					</section>
				))}
				<Para>
					{t("about.news.listedOn")}{" "}
					<a
						className={LINK}
						href={`${REPO}/releases`}
						target="_blank"
						rel="noreferrer"
					>
						GitHub
					</a>
					.
				</Para>
			</div>
		);
	if (doc === "apps")
		return (
			<div className="pb-4">
				<Lead lead={t("about.apps.webLead")}>{t("about.apps.web")}</Lead>
				<Lead lead={t("about.apps.phoneLead")}>
					{t("about.apps.phone")}
					{isDesktop ? "" : ` ${t("about.apps.phoneKeep")}`}
				</Lead>
				<Lead lead={t("about.apps.desktopLead")}>
					{t("about.apps.desktop")}{" "}
					<a
						className={LINK}
						href={`${REPO}/releases`}
						target="_blank"
						rel="noreferrer"
					>
						{t("about.apps.releases")}
					</a>
					. {t("about.apps.capture")}
				</Lead>
				<Para>{t("about.apps.share")}</Para>
			</div>
		);
	if (doc === "privacy")
		return (
			<div className="pb-4">
				<Lead lead={t("about.privacy.sealedLead")}>
					{t("about.privacy.sealed")}
				</Lead>
				<Lead lead={t("about.privacy.knowsLead")}>
					{t("about.privacy.knows")}
				</Lead>
				<Lead lead={t("about.privacy.shareLead")}>
					{t("about.privacy.share")}
				</Lead>
				<Lead lead={t("about.privacy.previewLead")}>
					{t("about.privacy.preview")}
				</Lead>
				<Lead lead={t("about.privacy.deviceLead")}>
					{t("about.privacy.device")}
				</Lead>
				<Lead lead={t("about.privacy.keyLead")}>{t("about.privacy.key")}</Lead>
			</div>
		);
	return (
		<div className="pb-3">
			<Para>{t("about.licencesIntro")}</Para>
			<ul className="mt-2">
				{LICENCES.map(([name, version, licence]) => (
					<li
						key={name}
						className="flex items-baseline gap-3 border-b border-line2 px-[22px] py-2 text-[13px]"
					>
						<span className="min-w-0 flex-1 truncate">{name}</span>
						<span className="font-mono text-xs text-mute">{version}</span>
						<span className="w-24 text-right text-ink2">{licence}</span>
					</li>
				))}
			</ul>
		</div>
	);
}

/** A row in Settings → About that opens one of the pages above. */
export function AboutRow({
	doc,
	label,
	desc,
	button,
}: {
	doc: Doc;
	label: string;
	desc: string;
	button: string;
}) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	return (
		<>
			<Row label={label} desc={desc}>
				<Btn onClick={() => setOpen(true)}>{button}</Btn>
			</Row>
			{open ? (
				<Modal
					title={t(TITLES[doc])}
					onClose={() => setOpen(false)}
					actions={
						<button
							type="button"
							onClick={() => setOpen(false)}
							className="h-9 rounded-2xl bg-ink px-4 text-[13px] font-medium text-paper"
						>
							{t("common.done")}
						</button>
					}
				>
					<Body doc={doc} />
				</Modal>
			) : null}
		</>
	);
}
