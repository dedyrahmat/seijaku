import { expect, type Page, test } from "@playwright/test";

async function newAccount(page: Page): Promise<string> {
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

async function signIn(page: Page, phrase: string) {
	await page.goto("/sign-in");
	await page.getByRole("button", { name: "Sign in with phrase" }).click();
	await page.locator("#sign-in-phrase").fill(phrase);
	await page
		.getByRole("button", { name: "Sign in with phrase" })
		.last()
		.click();
	await page.waitForURL((u) => u.pathname === "/");
}

const editor = (page: Page) => page.locator(".bn-editor");

async function type(page: Page, text: string) {
	await editor(page).click();
	await page.keyboard.press("Control+End");
	await page.keyboard.type(text);
}

test("two devices share one workspace: live edits, offline merge, offline reload", async ({
	browser,
}) => {
	const a = await (await browser.newContext()).newPage();
	const phrase = await newAccount(a);

	// Device A writes a page.
	await a.getByRole("button", { name: "New page" }).first().click();
	await a.locator("[data-title]").fill("Shared plan");
	await a.locator("[data-title]").press("Enter");
	await type(a, "from A.");

	// Device B signs in with the phrase and sees it.
	const b = await (await browser.newContext()).newPage();
	await signIn(b, phrase);
	await b
		.getByRole("link", { name: /Shared plan/ })
		.first()
		.click();
	await expect(editor(b)).toContainText("from A.", { timeout: 20_000 });

	// Live edit travels the other way.
	await type(b, " from B.");
	await expect(editor(a)).toContainText("from B.", { timeout: 20_000 });

	// Both go offline and keep writing; reconnecting merges both edits.
	await a.context().setOffline(true);
	await b.context().setOffline(true);
	await type(a, " A-offline.");
	await type(b, " B-offline.");
	await a.context().setOffline(false);
	await b.context().setOffline(false);
	for (const page of [a, b]) {
		await expect(editor(page)).toContainText("A-offline.", { timeout: 30_000 });
		await expect(editor(page)).toContainText("B-offline.", { timeout: 30_000 });
	}

	// The shell and the notes open with no network at all.
	await b.evaluate(() => navigator.serviceWorker.ready);
	await b.context().setOffline(true);
	await b.reload();
	await expect(editor(b)).toContainText("B-offline.", { timeout: 20_000 });
});
