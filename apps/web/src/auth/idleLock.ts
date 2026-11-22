import { useEffect } from "react";
import { getPrefs } from "../preferences";
import { authStore } from "./session";

const MINUTES = { "5 minutes": 5, "15 minutes": 15 } as const;
const EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"];

/**
 * "Lock after inactivity": while signed in, any use of the page resets a clock; when it runs
 * out the key is forgotten and the unlock screen takes over. Checks by wall-clock time so a
 * laptop that slept locks as soon as it wakes. The setting is read on every check.
 */
export function useIdleLock(): void {
	useEffect(() => {
		let last = Date.now();
		const touch = () => {
			last = Date.now();
		};
		for (const e of EVENTS)
			window.addEventListener(e, touch, { passive: true });
		const check = () => {
			const after = getPrefs().lockAfterIdle;
			if (after === "Never") return;
			if (Date.now() - last >= MINUTES[after] * 60_000) void authStore.lock();
		};
		const timer = setInterval(check, 15_000);
		document.addEventListener("visibilitychange", check);
		return () => {
			for (const e of EVENTS) window.removeEventListener(e, touch);
			clearInterval(timer);
			document.removeEventListener("visibilitychange", check);
		};
	}, []);
}
