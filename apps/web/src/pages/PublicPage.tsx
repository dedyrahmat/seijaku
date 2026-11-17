import { Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
	const { token } = useParams({ strict: false }) as { token?: string };
	const [state, setState] = useState<
		| { kind: "loading" }
		| { kind: "gone" }
		| { kind: "page"; title: string; blocks: Block[] }
	>({ kind: "loading" });

	useEffect(() => {
		let live = true;
		const key = location.hash.slice(1);
		const found = token && key ? openShared(token, key) : Promise.resolve(null);
		void found.then((page) => {
			if (!live) return;
			if (page) {
				document.title = `${page.title || "Untitled"} · Seijaku`;
				setState({ kind: "page", ...page });
			} else {
				document.title = "Shared page · Seijaku";
				setState({ kind: "gone" });
			}
		});
		return () => {
			live = false;
		};
	}, [token]);

	return (
		<div className="relative flex min-h-dvh flex-col overflow-hidden bg-paper text-ink">
			<header className="flex h-16 flex-wrap items-center gap-2.5 px-8">
				<Logo size={22} />
				<span className="font-serif text-lg font-medium">Seijaku</span>
				<div className="flex-1" />
				<span className="text-[13px] text-mute">Shared page · read only</span>
			</header>

			{state.kind === "page" ? (
				<main className="w-full flex-1">
					<ReadOnlyNote title={state.title} blocks={state.blocks} />
				</main>
			) : (
				<main className="mx-auto w-full max-w-[760px] flex-1 px-6 pt-14">
					{state.kind === "loading" ? (
						<p aria-busy="true" className="text-[17px] text-mute">
							Opening…
						</p>
					) : (
						<>
							<h1 className="font-serif text-[40px] leading-[1.1] font-medium tracking-[-0.015em]">
								This page is not available
							</h1>
							<p className="mt-4 text-[17px] leading-[1.75] text-ink2">
								The link may have been turned off, or it is missing part of its
								address.
							</p>
						</>
					)}
				</main>
			)}

			<footer className="flex flex-col items-center gap-1 px-6 pt-10 pb-7 text-center text-[13px] text-mute">
				<span>Active calm. The opposite of noise.</span>
				<Link to="/" className="text-ink2 underline">
					Keep your own notes with Seijaku
				</Link>
			</footer>
		</div>
	);
}
