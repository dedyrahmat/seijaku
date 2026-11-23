import { expect, test } from "@playwright/test";
import {
	choose,
	editor,
	newAccount,
	newPage,
	ownAddress,
	signIn,
	type,
} from "./helpers";

const sidebar = (page: import("@playwright/test").Page) =>
	page.getByRole("complementary", { name: "Pages" });

test("without an account: pages, nesting, rename and reload all stay on the device", async ({
	page,
}) => {
	await page.goto("/");
	await newPage(page, "Garden");
	await page.locator("[data-title]").press("Enter");
	await type(page, "raked gravel");

	// A page inside the first one, from the row menu.
	await page.getByRole("button", { name: "Actions for Garden" }).click();
	await page.getByRole("menuitem", { name: "Add a page inside" }).click();
	await page.locator("[data-title]").fill("Moss");

	// Rename the parent; the sidebar follows.
	await sidebar(page).getByRole("link", { name: "Garden" }).click();
	await page.locator("[data-title]").fill("Zen garden");
	await expect(
		sidebar(page).getByRole("link", { name: "Zen garden" }),
	).toBeVisible();

	await page.reload();
	await expect(
		sidebar(page).getByRole("link", { name: "Zen garden" }),
	).toBeVisible();
	await expect(editor(page)).toContainText("raked gravel");
	// The URL carries a readable slug and the id.
	await expect(page).toHaveURL(/\/page\/Zen-garden-/);
});

test("trash: move, restore, delete forever, empty", async ({ page }) => {
	await page.goto("/");
	await newPage(page, "Keep me");
	await newPage(page, "Gone soon");
	await newPage(page, "Gone later");

	await page.getByRole("button", { name: "Actions for Keep me" }).click();
	await page.getByRole("menuitem", { name: "Move to trash" }).click();
	await expect(
		sidebar(page).getByRole("link", { name: "Keep me", exact: true }),
	).toHaveCount(0);

	await page.goto("/trash");
	await expect(page.getByText("Keep me")).toBeVisible();
	await page
		.getByRole("button", { name: /^Restore/ })
		.first()
		.click();
	await expect(page.getByText("Nothing here.")).toBeVisible();
	await page.goto("/");
	await expect(
		sidebar(page).getByRole("link", { name: "Keep me", exact: true }),
	).toBeVisible();

	// Trash the other two, then empty everything.
	for (const name of ["Gone soon", "Gone later"]) {
		await page.getByRole("button", { name: `Actions for ${name}` }).click();
		await page.getByRole("menuitem", { name: "Move to trash" }).click();
	}
	await page.goto("/trash");
	await page.getByRole("button", { name: "Empty trash" }).click();
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: "Delete forever" })
		.click();
	await expect(page.getByText("Nothing here.")).toBeVisible();
});

test("search finds text inside a page and jumps to it", async ({ page }) => {
	await page.goto("/");
	await newPage(page, "Haiku draft");
	await page.locator("[data-title]").press("Enter");
	await type(page, "vermilion lantern");
	await newPage(page, "Other");

	await page.keyboard.press("Control+Shift+F");
	await page.getByPlaceholder("Search the text of every page").fill("lantern");
	await expect(page.getByText("Matches in your pages")).toBeVisible();
	await page.keyboard.press("Enter");
	await expect(page).toHaveURL(/\/page\/Haiku-draft-/);
	await expect(editor(page)).toContainText("vermilion lantern");

	// Jump by title.
	await page.keyboard.press("Control+k");
	await page.getByPlaceholder("Search or jump to").fill("Other");
	await page.keyboard.press("Enter");
	await expect(page).toHaveURL(/\/page\/Other-/);
});

test("sign out keeps the notes, a wrong phrase is refused, the right one signs back in", async ({
	browser,
}) => {
	const a = await (await browser.newContext()).newPage();
	const phrase = await newAccount(a);
	await newPage(a, "Private");
	await a.goto("/settings/sync");
	await a.getByRole("button", { name: "Sign out", exact: true }).click();
	// Notes stay on the device after signing out.
	await a.goto("/");
	await expect(sidebar(a).getByRole("link", { name: "Private" })).toBeVisible();

	// A phrase that is not the account's phrase is refused.
	await a.goto("/sign-in");
	await a.getByRole("button", { name: "Sign in with phrase" }).click();
	await a
		.locator("#sign-in-phrase")
		.fill(phrase.split(" ").reverse().join(" "));
	await a.getByRole("button", { name: "Sign in with phrase" }).last().click();
	await expect(a.getByRole("alert")).toBeVisible();

	await signIn(a, phrase);
	await expect(sidebar(a).getByRole("link", { name: "Private" })).toBeVisible();
});

test("share link opens read-only in a stranger's browser, then revoking closes it", async ({
	browser,
}) => {
	const a = await (await browser.newContext()).newPage();
	await newAccount(a);
	await newPage(a, "Public note");
	await a.locator("[data-title]").press("Enter");
	await type(a, "hello world wide");

	await a.getByRole("button", { name: "Share", exact: true }).click();
	await a.getByRole("switch", { name: "Share to the web" }).click();
	await expect(a.getByLabel("Public link")).toHaveValue(/\/share\/.+#.+/);
	const link = await a.getByLabel("Public link").inputValue();

	const stranger = await (await browser.newContext()).newPage();
	await stranger.goto(link);
	await expect(stranger.getByText("hello world wide")).toBeVisible({
		timeout: 20_000,
	});
	await expect(
		stranger.locator(".bn-editor [contenteditable=true]"),
	).toHaveCount(0);

	await a.getByRole("button", { name: "Revoke link" }).click();
	// A confirm dialog guards revoking.
	await a
		.getByRole("alertdialog")
		.getByRole("button", { name: "Revoke link" })
		.click();
	await stranger.reload();
	await expect(stranger.getByText("hello world wide")).toHaveCount(0, {
		timeout: 20_000,
	});
});

test("version history lists the page and the panel closes", async ({
	page,
}) => {
	await page.goto("/");
	const phrase = await newAccount(page);
	expect(phrase.split(" ")).toHaveLength(12);
	await newPage(page, "Versioned");
	await page.locator("[data-title]").press("Enter");
	await type(page, "first draft");

	await page.getByRole("button", { name: "Version history" }).click();
	const panel = page.getByRole("complementary", { name: "Version history" });
	await expect(panel).toBeVisible();
	await expect(panel.getByText("Current")).toBeVisible();
	await page.getByRole("button", { name: "Close history" }).click();
	await expect(panel).toHaveCount(0);
});

test("quick capture lands in today's note", async ({ page }) => {
	await page.goto("/capture");
	const box = page.getByPlaceholder("Write something down");
	// Enter is ignored until the workspace has loaded, so retry until the box empties.
	await expect(async () => {
		await box.fill("buy ink");
		await box.press("Enter");
		await expect(box).toHaveValue("", { timeout: 1000 });
	}).toPass();
	// Quick capture appends to today's note by default.
	await page.goto("/");
	await sidebar(page)
		.getByRole("button", { name: /^Today/ })
		.click();
	await expect(editor(page)).toContainText("buy ink");
});

test("import markdown files, change theme and language, export", async ({
	page,
}) => {
	await page.goto("/import");
	await page.getByRole("button", { name: "Markdown Files or folder" }).click();
	await page
		.locator('input[type="file"]')
		.first()
		.setInputFiles({
			name: "Imported idea.md",
			mimeType: "text/markdown",
			buffer: Buffer.from("# Imported idea\n\nbrought from elsewhere\n"),
		});
	await page.getByRole("button", { name: "Continue" }).click();
	await expect(
		sidebar(page).getByRole("link", { name: "Imported idea" }),
	).toBeVisible({ timeout: 20_000 });

	// Theme lands on <html data-theme>.
	await page.goto("/settings/appearance");
	const theme = page.getByRole("radiogroup", { name: "Colour theme" });
	await theme.getByRole("radio", { name: "Dark" }).click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	await theme.getByRole("radio", { name: "Light" }).click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

	// Language switches the interface.
	await page.goto("/settings/general");
	await choose(page, "Language", "Bahasa Indonesia");
	await expect(page.getByText("Pengaturan").first()).toBeVisible();
	await page.reload();
	await expect(page.getByText("Pengaturan").first()).toBeVisible();

	// Export everything downloads a zip.
	await page.goto("/settings/data");
	const download = page.waitForEvent("download");
	await page.getByRole("button", { name: /Export all|Ekspor semua/ }).click();
	expect((await download).suggestedFilename()).toMatch(/\.zip$/);
});

test("delete account removes it from the server: the phrase no longer signs in", async ({
	browser,
}) => {
	const a = await (await browser.newContext()).newPage();
	const phrase = await newAccount(a);
	await a.goto("/settings/security");
	await a.getByRole("button", { name: "Delete…" }).click();
	await a.getByRole("button", { name: "Continue" }).click();
	await a.getByPlaceholder("word word word…").fill(phrase);
	await a.getByLabel(/Type DELETE/).fill("DELETE");
	await a.getByRole("button", { name: "Delete my account" }).click();
	await expect(a.getByText("Account deleted")).toBeVisible({ timeout: 30_000 });
	await a.getByRole("button", { name: "Keep them on this device" }).click();

	const b = await (await browser.newContext()).newPage();
	await ownAddress(b);
	await b.goto("/sign-in");
	await b.getByRole("button", { name: "Sign in with phrase" }).click();
	await b.locator("#sign-in-phrase").fill(phrase);
	await b.getByRole("button", { name: "Sign in with phrase" }).last().click();
	await expect(b.getByRole("alert")).toBeVisible();
});
