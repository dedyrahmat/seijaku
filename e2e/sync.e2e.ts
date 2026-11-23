import { expect, test } from "@playwright/test";
import { editor, newAccount, newPage, signIn, type } from "./helpers";

test("two devices share one workspace: live edits, offline merge, offline reload", async ({
	browser,
}) => {
	const a = await (await browser.newContext()).newPage();
	const phrase = await newAccount(a);

	// Device A writes a page.
	await newPage(a, "Shared plan");
	await a.locator("[data-title]").press("Enter");
	await type(a, "from A.");

	// Device B signs in with the phrase and sees it.
	const b = await (await browser.newContext()).newPage();
	await signIn(b, phrase);
	// The worker needs a moment to install; going offline before it has would leave nothing cached.
	await b.evaluate(() => navigator.serviceWorker.ready);
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
	await b.context().setOffline(true);
	await b.reload();
	await expect(editor(b)).toContainText("B-offline.", { timeout: 20_000 });
});

test("a journal entry and a bulk move to trash reach the other device", async ({
	browser,
}) => {
	const a = await (await browser.newContext()).newPage();
	const phrase = await newAccount(a);

	await newPage(a, "One");
	await newPage(a, "Two");
	await a.getByRole("button", { name: "New page" }).first().click();
	await a.keyboard.press("4");
	await a.getByRole("button", { name: "Create journal entry" }).click();

	const b = await (await browser.newContext()).newPage();
	await signIn(b, phrase);
	for (const name of ["One", "Two", "Journal"])
		await expect(
			b.getByRole("link", { name, exact: true }).first(),
		).toBeVisible({
			timeout: 20_000,
		});

	// Select both pages on A and move them to the trash in one go.
	await a.getByRole("button", { name: "Actions for One" }).click();
	await a.getByRole("menuitem", { name: "Select pages" }).click();
	await a.getByRole("button", { name: "Two", pressed: false }).click();
	await expect(a.getByText("2 pages selected")).toBeVisible();
	await a.getByRole("button", { name: "Move to trash" }).click();

	for (const name of ["One", "Two"])
		await expect(b.getByRole("link", { name, exact: true })).toHaveCount(0, {
			timeout: 20_000,
		});
});

test("a mood, an attendee and a change of type reach the other device", async ({
	browser,
}) => {
	const a = await (await browser.newContext()).newPage();
	const phrase = await newAccount(a);

	// A meeting with one attendee, then (so it is not saved inside Journal) a journal entry with a mood.
	await a.getByRole("button", { name: "New page" }).first().click();
	await a.keyboard.press("5");
	await a.getByRole("button", { name: "Create meeting notes" }).click();
	await a.locator("[data-title]").fill("Weekly sync");
	await a.getByLabel("Add a person").fill("Aiko");
	await a.getByLabel("Add a person").press("Enter");

	await a.getByRole("button", { name: "New page" }).first().click();
	await a.keyboard.press("4");
	await a.getByRole("button", { name: "Create journal entry" }).click();
	await a.getByRole("button", { name: "Good", exact: true }).click();

	const b = await (await browser.newContext()).newPage();
	await signIn(b, phrase);
	await b
		.getByRole("link", { name: "Weekly sync", exact: true })
		.first()
		.click();
	await expect(b.getByText("Aiko", { exact: true })).toBeVisible({
		timeout: 20_000,
	});
	// Today's journal entry has a fixed id, so B can open it by address.
	const day = await b.evaluate(() => {
		const d = new Date();
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
	});
	await b.goto(`/page/Entry-journal-${day}`);
	await expect(
		b.getByRole("button", { name: "Good", pressed: true }),
	).toBeVisible({ timeout: 20_000 });

	// Change the meeting into a study note on A; B sees the study head.
	await a
		.getByRole("link", { name: "Weekly sync", exact: true })
		.first()
		.click();
	await a.getByRole("button", { name: "More" }).first().click();
	await a.getByRole("menuitemradio", { name: "Study note" }).click();
	await b
		.getByRole("link", { name: "Weekly sync", exact: true })
		.first()
		.click();
	await expect(b.getByLabel("Subject")).toBeVisible({ timeout: 20_000 });
});
