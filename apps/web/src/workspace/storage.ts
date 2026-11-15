/**
 * Browsers may evict a site's stored data when space runs low. Chrome and Firefox grant
 * persistent storage to sites people use; Safari on iPhone and iPad only does so for an app
 * added to the Home Screen. That is the one case where the "Keep your notes safe" notice
 * from the design applies, because it tells people to add Seijaku to the Home Screen.
 */
export function needsHomeScreenNotice(env: {
	persisted: boolean | null;
	userAgent: string;
	maxTouchPoints: number;
	standalone: boolean;
}): boolean {
	if (env.persisted !== false || env.standalone) return false;
	const iPhoneOrPad = /iPhone|iPad|iPod/.test(env.userAgent);
	// iPadOS reports itself as a Mac but has a touch screen.
	const iPadAsMac = /Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1;
	return iPhoneOrPad || iPadAsMac;
}

export function readStorageEnv(persisted: boolean | null) {
	return {
		persisted,
		userAgent: navigator.userAgent,
		maxTouchPoints: navigator.maxTouchPoints,
		standalone:
			window.matchMedia("(display-mode: standalone)").matches ||
			(navigator as unknown as { standalone?: boolean }).standalone === true,
	};
}
