# Translating Seijaku

Seijaku's interface can be shown in more than one language. English (`en`) is the source; Bahasa Indonesia (`id`) is the first translation. You do not need to write code to help: a language is one JSON file.

Your notes are never translated. Only the app's own words are.

## Where things are

| Path                             | What it is                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------ |
| `apps/web/src/i18n/en.json`      | Every piece of text in the app, in English. The source of truth.               |
| `apps/web/src/i18n/id.json`      | The Indonesian translation. Same shape as `en.json`.                           |
| `apps/web/src/i18n/index.ts`     | Registers the languages (`LANGUAGES`) and follows the Language setting.        |
| `apps/web/src/i18n/i18n.test.ts` | Checks that every translation has the same keys and placeholders as `en.json`. |

Each entry is `"key": "text"`. The key is the address the code looks up; **never rename or delete a key**, only change the text on the right.

```json
"sidebar": {
  "search": "Cari atau lompat ke"
}
```

## Add a language

1. Copy `apps/web/src/i18n/en.json` to `apps/web/src/i18n/<code>.json`. Use the two-letter [ISO 639-1 code](https://en.wikipedia.org/wiki/List_of_ISO_639_language_codes) (`de`, `fr`, `ja`), or a tag like `pt-BR` when the region matters.
2. Translate the text on the right of every entry (rules below).
3. Add the language name in its own language to **every** language file, under `language`:

   ```json
   "language": { "en": "English", "id": "Bahasa Indonesia", "de": "Deutsch" }
   ```
4. Register it in `apps/web/src/i18n/index.ts`: add the code to `LANGUAGES`, import the file, and add it to `resources`.
5. Run the checks and look at it in the app (below).

Anything you leave out falls back to English, so a partial translation still works. The test will tell you what is missing.

## Rules for the text

- **Keep `{{placeholders}}` exactly as they are.** `"Last active {{when}}"` becomes `"Terakhir aktif {{when}}"`. You may move them where your grammar needs them, but do not translate or drop them.
- **Plurals.** Keys ending in `_one` and `_other` are chosen by a number (`{{count}}`). Provide the forms your language uses: the plural categories are listed at [CLDR plural rules](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html) (English: `one`, `other`; Indonesian and Japanese: only `other`; Polish and Russian also `few` and `many`; Arabic has all six). Write `_zero`, `_two`, `_few`, `_many` where your language has them.
- **Do not translate the product name** (Seijaku), library names, file formats (`.zip`, `Markdown`) or keyboard keys' symbols. Brand words like "Washi" and "Kaki" (note colours) are names; keep them or give a short, calm equivalent.
- **Keep the tone.** Seijaku is "active calm": short, plain, quiet. No exclamation marks, no marketing.
- **Mind the length.** Buttons and menu rows are narrow, especially on a phone. Prefer the shorter wording when two are equally good.
- **Settings values.** Entries under `prefs.*` are the text shown for a stored setting; the key (for example `"After 7 days"`) is how it is saved. Translate only the right side.
- **Text inside notes.** Some entries (the templates under `templates.*`) are written _into_ a new note. They become the user's own text, so translate them as the writer would.
- Use the typographic quotes `“ ”` and ellipsis `…` that the English file uses, or your language's own.

## Check your work

```bash
bun test apps/web/src/i18n     # same keys, same placeholders as en.json
bun run typecheck
bun run lint
bun run --cwd apps/web dev     # then Settings → General → Language
```

In the app, click through Settings, the sidebar, a new note (all six types), Trash, Import, Share, History and the sign-in pages in light and dark, at desktop width and at phone width. Look for text that is cut off or wraps badly.

## What is not translated yet

- The six haiku on the Home screen.
- BlockNote's own menus and placeholders inside the editor (the "/" menu is ours and is translated; its drag handle, formatting toolbar, table and link popovers are BlockNote's). BlockNote ships locales for some languages but not Indonesian; supplying a dictionary is a separate step.
- Warnings the importers write into the import report note.

## Adding text to the app (for developers)

Never write user-facing English directly in a component. Add the key to `en.json` and use it:

```tsx
const { t } = useTranslation();
<button>{t("common.save")}</button>;
```

Outside a component, import `i18n` from `apps/web/src/i18n` and call `i18n.t(...)`. Use `dateLocale()` for dates and times, and `_one` / `_other` keys with `count` for anything that can be 1 or many. Add the Indonesian text in the same change (the test fails until the key exists in every language).
