import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiUrl } from "../workspace/syncUrl";
import { Group, Row } from "./SettingRows";

interface Use {
	used: number;
	limit: number;
}
interface Usage {
	files: Use;
	snapshots: Use;
	shares: Use;
}

const mb = (n: number) =>
	n >= 1048576 ? `${Math.round(n / 1048576)} MB` : `${Math.round(n / 1024)} KB`;

function Meter({ use, line }: { use: Use; line: string }) {
	const pct = use.limit > 0 ? Math.min(100, (use.used / use.limit) * 100) : 0;
	return (
		<div className="flex flex-col gap-1.5">
			<span className="text-[13px] text-ink2">{line}</span>
			{use.limit > 0 ? (
				<div className="h-1.5 w-40 overflow-hidden rounded-full bg-hover">
					<div
						className="h-full bg-ink2"
						style={{ width: `${pct}%` }}
						aria-hidden
					/>
				</div>
			) : null}
		</div>
	);
}

/** What the account uses on the server, against the limits its operator set. */
export function StorageGroup() {
	const { t } = useTranslation();
	const [usage, setUsage] = useState<Usage | null>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		let live = true;
		fetch(apiUrl("/api/usage"), { credentials: "include" })
			.then((r) => (r.ok ? (r.json() as Promise<Usage>) : Promise.reject()))
			.then((u) => live && setUsage(u))
			.catch(() => live && setFailed(true));
		return () => {
			live = false;
		};
	}, []);

	const line = (
		use: Use,
		of:
			| "settings.storage.filesOf"
			| "settings.storage.snapshotsOf"
			| "settings.storage.sharesOf",
		fmt: (n: number) => string,
	) =>
		use.limit > 0
			? t(of, { used: fmt(use.used), limit: fmt(use.limit) })
			: t("settings.storage.noLimit", { used: fmt(use.used) });
	const num = (n: number) => n.toLocaleString();

	return (
		<Group name={t("settings.storage.title")}>
			{usage ? (
				<>
					<Row label={t("settings.storage.files")}>
						<Meter
							use={usage.files}
							line={line(usage.files, "settings.storage.filesOf", mb)}
						/>
					</Row>
					<Row label={t("settings.storage.snapshots")}>
						<Meter
							use={usage.snapshots}
							line={line(usage.snapshots, "settings.storage.snapshotsOf", num)}
						/>
					</Row>
					<Row
						label={t("settings.storage.shares")}
						desc={t("settings.storage.note")}
					>
						<Meter
							use={usage.shares}
							line={line(usage.shares, "settings.storage.sharesOf", num)}
						/>
					</Row>
				</>
			) : (
				<p className="py-3 text-[13px] text-mute">
					{failed ? t("settings.storage.failed") : "…"}
				</p>
			)}
		</Group>
	);
}
