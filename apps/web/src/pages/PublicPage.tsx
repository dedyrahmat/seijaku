import { Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { Logo } from "../components/Logo";

/**
 * The mockup's "Public share page": no sidebar, no sign-in, the page alone. The server that serves
 * share links arrives in phase 7, so for now every link says it is not available.
 */
export function PublicPage() {
	useEffect(() => {
		document.title = "Shared page · Seijaku";
	}, []);

	return (
		<div className="relative flex min-h-dvh flex-col overflow-hidden bg-paper text-ink">
			<header className="flex h-16 flex-wrap items-center gap-2.5 px-8">
				<Logo size={22} />
				<span className="font-serif text-lg font-medium">Seijaku</span>
				<div className="flex-1" />
				<span className="text-[13px] text-mute">Shared page · read only</span>
			</header>

			<main className="mx-auto w-full max-w-[760px] flex-1 px-6 pt-14">
				<h1 className="font-serif text-[40px] leading-[1.1] font-medium tracking-[-0.015em]">
					This page is not available
				</h1>
				<p className="mt-4 text-[17px] leading-[1.75] text-ink2">
					The link may have been turned off, or this server does not share pages
					yet.
				</p>
			</main>

			<footer className="flex flex-col items-center gap-1 px-6 pt-10 pb-7 text-center text-[13px] text-mute">
				<span>Active calm. The opposite of noise.</span>
				<Link to="/" className="text-ink2 underline">
					Keep your own notes with Seijaku
				</Link>
			</footer>
		</div>
	);
}
