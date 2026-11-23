import { Navigate, useParams } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { askConfirm } from "../components/Dialogs";
import { collab } from "../workspace/collab";
import { useCollab } from "../workspace/hooks";
import type { NoteSession } from "../workspace/store";

const Editor = lazy(() =>
	import("../editor/Editor").then((m) => ({ default: m.Editor })),
);

/** A page someone shared with this account: their copy of it, live while the page is shared. */
export function SharedPage() {
	const { t } = useTranslation();
	const { id } = useParams({ strict: false }) as { id: string };
	const entry = useCollab().find(([k]) => k === id)?.[1];
	const [session, setSession] = useState<NoteSession | null>(null);
	const [title, setTitle] = useState("");

	useEffect(() => {
		let live = true;
		const s = collab.openShared(id);
		void s.ready.then(() => live && setSession(s));
		const meta = s.doc.getMap<string>("meta");
		const read = () => {
			const v = String(meta.get("title") ?? "");
			setTitle(v);
			collab.rememberTitle(id, v);
		};
		read();
		meta.observe(read);
		return () => {
			live = false;
			meta.unobserve(read);
		};
	}, [id]);

	useEffect(() => {
		document.title = `${title || t("collab.sharedPage")} · Seijaku`;
	}, [title, t]);

	if (!entry) return <Navigate to="/" replace />;
	const readOnly = entry.role === "reader" || Boolean(entry.ended);
	const leave = async () => {
		const ok = await askConfirm(
			entry.ended ? t("collab.removeFromList") : t("collab.leaveConfirm"),
			{
				confirm: entry.ended ? t("common.remove") : t("collab.leave"),
				danger: true,
			},
		);
		if (ok) await collab.leave(id).catch(() => undefined);
	};
	return (
		<article className="relative mx-auto w-full max-w-[var(--page-width,760px)] px-5 pt-10 pb-[40vh] md:pt-[72px]">
			<div className="font-mono text-[11px] tracking-[0.06em] text-mute uppercase">
				{entry.ended
					? t("collab.ended")
					: `${t("collab.sharedWithYou")} · ${t(`collab.role.${entry.role}`)}`}
			</div>
			<h1 className="my-1.5 font-serif text-[44px] leading-[1.1] font-medium tracking-[-0.015em]">
				{title || t("common.untitled")}
			</h1>
			{readOnly ? (
				<div className="my-3 flex items-center gap-3 rounded-xl bg-panel px-3.5 py-2.5 text-[13px] text-ink2">
					<span className="flex-1">
						{entry.ended ? t("collab.endedNote") : t("collab.readerBanner")}
					</span>
					<button
						type="button"
						onClick={leave}
						className="h-8 rounded-full border border-line px-3.5 text-[13px] text-ink hover:bg-hover"
					>
						{entry.ended ? t("common.remove") : t("collab.leave")}
					</button>
				</div>
			) : (
				<div className="my-3 text-right">
					<button
						type="button"
						onClick={leave}
						className="text-[13px] text-mute hover:text-ink"
					>
						{t("collab.leave")}
					</button>
				</div>
			)}
			{session ? (
				<Suspense fallback={null}>
					<Editor
						key={`shared-${id}`}
						session={session}
						autoFocus={false}
						readOnly={readOnly}
					/>
				</Suspense>
			) : null}
		</article>
	);
}
