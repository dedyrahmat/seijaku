import { Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Logo } from "../components/Logo";
import { ReadOnlyNote } from "../components/ReadOnlyNote";
import type { Block } from "../editor/headless";
import { openShared } from "../workspace/shares";

/**
 * The mockup's "Public share page": no sidebar, no sign-in, the page alone. The link is
 * /share/<token>#<key>. The server sends sealed bytes for the token; the key stays in the
 * #fragment, which the browser never sends, so only this tab can open the page.
 */
export function PublicPage() {
	const { t } = useTranslation();
	const { token } = useParams({ strict: false }) as { token?: string };
	const [state, setState] = useState<
		| { kind: "loading" }
		| { kind: "gone"; expired: boolean }
		| {
				kind: "page";
				title: string;
				blocks: Block[];
				workspace: string;
				updatedAt: number;
		  }
	>({ kind: "loading" });

	useEffect(() => {
		let live = true;
		const key = location.hash.slice(1);
		const found = token && key ? openShared(token, key) : Promise.resolve(null);
		void found.then((page) => {
			if (!live) return;
			if (page && page !== "expired") {
				document.title = t("public.title", {
					title: page.title || t("common.untitled"),
				});
				setState({ kind: "page", ...page });
			} else {
				document.title = t("public.sharedTitle");
				setState({ kind: "gone", expired: page === "expired" });
			}
		});
		return () => {
			live = false;
		};
	}, [token, t]);

	return (
		<div className="relative flex min-h-dvh flex-col overflow-hidden bg-paper text-ink">
			<header className="flex h-16 flex-wrap items-center gap-2.5 px-8">
				<Logo size={22} />
				<span className="font-serif text-lg font-medium">Seijaku</span>
				<div className="flex-1" />
				<span className="text-[13px] text-mute">
					{state.kind === "page" && state.workspace
						? t("public.sharedFrom", { name: state.workspace })
						: t("public.sharedReadOnly")}
					{state.kind === "page" && state.updatedAt
						? ` · ${t("public.updated", {
								when: new Date(state.updatedAt).toLocaleDateString(undefined, {
									day: "numeric",
									month: "short",
									year: "numeric",
								}),
							})}`
						: ""}
				</span>
			</header>

			{state.kind === "page" ? (
				<main className="w-full flex-1">
					<ReadOnlyNote title={state.title} blocks={state.blocks} />
				</main>
			) : (
				<main className="mx-auto w-full max-w-[760px] flex-1 px-6 pt-14">
					{state.kind === "loading" ? (
						<p aria-busy="true" className="text-[17px] text-mute">
							{t("public.opening")}
						</p>
					) : (
						<>
							<h1 className="font-serif text-[40px] leading-[1.1] font-medium tracking-[-0.015em]">
								{state.expired
									? t("public.expiredTitle")
									: t("public.goneTitle")}
							</h1>
							<p className="mt-4 text-[17px] leading-[1.75] text-ink2">
								{state.expired ? t("public.expiredDesc") : t("public.goneDesc")}
							</p>
						</>
					)}
				</main>
			)}

			<footer className="flex flex-col items-center gap-1 px-6 pt-10 pb-7 text-center text-[13px] text-mute">
				<span>{t("tagline")}</span>
				<Link to="/" className="text-ink2 underline">
					{t("public.cta")}
				</Link>
			</footer>
		</div>
	);
}
