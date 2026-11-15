import { useSyncExternalStore } from "react";

const query = "(prefers-color-scheme: dark)";

function subscribe(onChange: () => void): () => void {
	const mq = window.matchMedia(query);
	mq.addEventListener("change", onChange);
	return () => mq.removeEventListener("change", onChange);
}

/** Seijaku follows the system theme: washi paper by day, sumi ink by night. */
export function useColorScheme(): "light" | "dark" {
	return useSyncExternalStore(
		subscribe,
		() => (window.matchMedia(query).matches ? "dark" : "light"),
		() => "light",
	);
}
