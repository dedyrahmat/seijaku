import { pageSlug } from "@seijaku/sync";

/** Link target for a page: `/page/Getting-Started-<id>`. Spread it onto `<Link>`, `navigate` or `<Navigate>`. */
export function pageLink(id: string, title: string) {
	return { to: "/page/$slug", params: { slug: pageSlug(title, id) } } as const;
}

/** Link target for a quick note's card on the wall. */
export function quickLink(id: string, title: string) {
	return {
		to: "/quick-notes/$slug",
		params: { slug: pageSlug(title, id) },
	} as const;
}
