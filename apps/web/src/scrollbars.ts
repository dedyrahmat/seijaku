/** Scrollbars stay out of sight until something scrolls, then fade away again (see "Scrollbars" in styles.css). */
const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>();

export function initScrollbars(): void {
	document.addEventListener(
		"scroll",
		(e) => {
			const el =
				e.target instanceof Element ? e.target : document.documentElement;
			el.setAttribute("data-scrolling", "");
			clearTimeout(timers.get(el));
			timers.set(
				el,
				setTimeout(() => el.removeAttribute("data-scrolling"), 900),
			);
		},
		{ capture: true, passive: true },
	);
}
