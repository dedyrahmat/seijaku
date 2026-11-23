import { expect, test } from "@playwright/test";
import { choose, newAccount, signIn } from "./helpers";

test("workspace name syncs, typing rules apply, clear cache keeps notes, idle lock asks for the phrase", async ({
	browser,
}) => {
	const context = await browser.newContext();
	const a = await context.newPage();
	await a.clock.install();
	const phrase = await newAccount(a);

	// The workspace name is set in Settings and shows in the sidebar on both devices.
	await a.goto("/settings/general");
	await a.getByLabel("Workspace name").fill("Dedy notes");
	await a.getByLabel("Workspace name").press("Enter");
	await expect(
		a.getByRole("complementary", { name: "Pages" }).getByText("Dedy notes"),
	).toBeVisible();
	const b = await (await browser.newContext()).newPage();
	await signIn(b, phrase);
	await expect(
		b.getByRole("complementary", { name: "Pages" }).getByText("Dedy notes"),
	).toBeVisible({ timeout: 20_000 });

	// Smart punctuation (on by default) and auto-pair (switched on here).
	await a.goto("/settings/editor");
	await a
		.getByRole("switch", { name: "Auto-pair brackets and quotes" })
		.click();
	await a.goto("/");
	await a.getByRole("button", { name: "New page" }).first().click();
	await a.getByRole("dialog", { name: "New note" }).waitFor();
	await a.keyboard.press("2");
	await a.getByRole("button", { name: "Create page" }).click();
	await a.locator("[data-title]").fill("Typing");
	await a.locator("[data-title]").press("Enter");
	await a.keyboard.type('He said "hi" and left... (ok');
	await expect(a.locator(".bn-editor")).toContainText(
		"He said “hi” and left… (ok)",
	);

	// Clear cache: confirms, reloads, and the notes come back from the server.
	await a.goto("/settings/data");
	await a.getByRole("button", { name: "Clear cache" }).click();
	await expect(
		a.getByRole("alertdialog", { name: /Clear offline/ }),
	).toBeVisible({ timeout: 20_000 });
	await a.getByRole("button", { name: "Clear and reload" }).click();
	await expect(a.getByRole("link", { name: /Typing/ }).first()).toBeVisible({
		timeout: 30_000,
	});

	// Lock after inactivity: the key is forgotten; the phrase opens the notes again.
	await a.goto("/settings/security");
	await choose(a, "Lock after inactivity", "5 minutes");
	await a.clock.fastForward("06:00");
	await expect(a.getByRole("heading", { name: "Locked" })).toBeVisible({
		timeout: 20_000,
	});
	await a
		.getByRole("button", { name: "Use my recovery phrase instead" })
		.click();
	await a.locator("#unlock-phrase").fill(phrase);
	await a.getByRole("button", { name: "Unlock with phrase" }).click();
	await expect(a.getByRole("link", { name: /Typing/ }).first()).toBeVisible({
		timeout: 20_000,
	});
});

test("Open on start lands on Today, or on the last page", async ({ page }) => {
	await newAccount(page);
	await page.goto("/settings/general");
	await choose(page, "Open on start", "Today");
	await page.goto("/");
	await expect(page).toHaveURL(/\/page\/.*daily-\d{4}-\d{2}-\d{2}/);

	await page.getByRole("button", { name: "New page" }).first().click();
	await page.getByRole("dialog", { name: "New note" }).waitFor();
	await page.keyboard.press("2");
	await page.getByRole("button", { name: "Create page" }).click();
	await page.locator("[data-title]").fill("Where I left off");
	await page.goto("/settings/general");
	await choose(page, "Open on start", "Last page");
	await page.goto("/");
	await expect(page).toHaveURL(/Where-I-left-off/);

	await page.goto("/settings/general");
	await choose(page, "Open on start", "Home");
	await page.goto("/");
	await expect(page).toHaveURL(/\/$/);
});
