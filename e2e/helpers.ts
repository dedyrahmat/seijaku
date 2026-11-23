import type { Page } from "@playwright/test";

let ips = 0;

/**
 * The server rate-limits sign-up and phrase sign-in per client address (5 per 15 minutes), and the
 * test server sees one shared address. Give each browser context its own via x-forwarded-for.
 */
export async function ownAddress(page: Page) {
	ips += 1;
	await page.context().setExtraHTTPHeaders({
		"x-forwarded-for": `10.1.${ips >> 8}.${ips & 255}`,
	});
}

/** Create an account with a generated phrase; returns the 12 words. */
export async function newAccount(page: Page): Promise<string> {
	await ownAddress(page);
	await page.goto("/setup");
	await page.getByRole("button", { name: "Generate a phrase instead" }).click();
	await page.getByRole("list", { name: "Recovery phrase" }).waitFor();
	const words = await page
		.locator('ol[aria-label="Recovery phrase"] li span:last-child')
		.allTextContents();
	await page.getByLabel("I saved these words somewhere safe").check();
	await page.getByRole("button", { name: "Open my notes" }).click();
	return words.join(" ");
}

export async function signIn(page: Page, phrase: string) {
	await ownAddress(page);
	await page.goto("/sign-in");
	await page.getByRole("button", { name: "Sign in with phrase" }).click();
	await page.locator("#sign-in-phrase").fill(phrase);
	await page
		.getByRole("button", { name: "Sign in with phrase" })
		.last()
		.click();
	await page.waitForURL((u) => u.pathname === "/");
}

/** The settings dropdowns are a custom listbox, not a <select>. */
export async function choose(page: Page, label: string, option: string) {
	await page.getByLabel(label).click();
	await page.getByRole("option", { name: option, exact: true }).click();
}

/** The sidebar + opens the picker; Page is card 2. */
export async function newPage(page: Page, title: string) {
	await page.getByRole("button", { name: "New page" }).first().click();
	await page.getByRole("dialog", { name: "New note" }).waitFor();
	await page.keyboard.press("2");
	await page.getByRole("button", { name: "Create page" }).click();
	await page.locator("[data-title]").fill(title);
}

export const editor = (page: Page) => page.locator(".bn-editor");

export async function type(page: Page, text: string) {
	await editor(page).click();
	await page.keyboard.press("Control+End");
	await page.keyboard.type(text);
}
