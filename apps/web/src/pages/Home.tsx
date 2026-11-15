import { useEffect, useState } from "react";
import { Logo } from "../components/Logo";

export const LAST_NOTE_KEY = "seijaku:last-note";

/** From the design's Home board: a still screen with one slowly changing poem. */
const HAIKU = [
	[
		"Blank page, breath held still,",
		"a first line settles slowly,",
		"noise fades from the room.",
	],
	[
		"Ink finds the paper,",
		"thoughts sink like stones in water,",
		"ripples become words.",
	],
	[
		"Rake the gravel smooth,",
		"each line a quiet ripple,",
		"nothing left to chase.",
	],
	[
		"Snow on the notebook,",
		"what you write is what stays warm,",
		"the rest melts to white.",
	],
	[
		"Wind stops at the door,",
		"pages turn without a sound,",
		"the lamp burns steady.",
	],
	[
		"Offline and still here,",
		"your words keep their own slow time,",
		"the moon waits for sync.",
	],
] as const;

const SHOW_MS = 7000;
const FADE_MS = 900;

export function Home() {
	const [index, setIndex] = useState(0);
	const [fading, setFading] = useState(false);

	useEffect(() => {
		const reduced = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;
		let swap: ReturnType<typeof setTimeout> | undefined;
		const tick = setInterval(() => {
			setFading(true);
			swap = setTimeout(
				() => {
					setIndex((i) => (i + 1) % HAIKU.length);
					setFading(false);
				},
				reduced ? 0 : FADE_MS,
			);
		}, SHOW_MS);
		return () => {
			clearInterval(tick);
			clearTimeout(swap);
		};
	}, []);

	const poem = HAIKU[index] ?? HAIKU[0];

	return (
		<div className="flex min-h-full flex-col items-center justify-center px-6 py-10 text-center">
			<Logo size={160} />
			<h1 className="mt-11 font-serif text-[56px] leading-none font-medium tracking-[-0.01em] md:text-[88px]">
				Seijaku
			</h1>
			<p
				lang="ja"
				className="mt-3.5 pl-[0.5em] font-serif text-xl tracking-[0.5em] text-mute"
			>
				静寂
			</p>
			<div className="mt-14 mb-10 h-px w-12 bg-line" />
			<div
				aria-live="polite"
				style={{ opacity: fading ? 0 : 1 }}
				className="flex min-h-[150px] flex-col items-center gap-2.5 font-serif text-[22px] leading-[1.35] text-ink2 italic transition-opacity duration-[900ms] motion-reduce:transition-none md:text-[30px]"
			>
				{poem.map((line) => (
					<span key={line}>{line}</span>
				))}
			</div>
			<div className="mt-9 flex gap-2.5" aria-hidden>
				{HAIKU.map((poemLines, k) => (
					<span
						key={poemLines[0]}
						className={`size-1.5 rounded-full ${k === index ? "bg-accent" : "bg-line"}`}
					/>
				))}
			</div>
		</div>
	);
}
