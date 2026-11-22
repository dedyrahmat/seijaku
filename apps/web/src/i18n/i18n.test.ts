import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import en from "./en.json";

/** Every language file must carry the same keys and {{placeholders}} as en.json (see docs/TRANSLATING.md). */

const PLURAL = /_(zero|one|two|few|many|other)$/;
type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Map<string, string> {
	const out = new Map<string, string>();
	for (const [k, v] of Object.entries(tree)) {
		const key = prefix ? `${prefix}.${k}` : k;
		if (typeof v === "string") out.set(key, v);
		else for (const [a, b] of flatten(v, key)) out.set(a, b);
	}
	return out;
}

const vars = (s: string) => [...new Set(s.match(/\{\{\w+\}\}/g) ?? [])].sort();
const base = (k: string) => k.replace(PLURAL, "");

const source = flatten(en);
const sourceKeys = new Set([...source.keys()].map(base));

const languages = readdirSync(import.meta.dir)
	.filter((f) => f.endsWith(".json") && f !== "en.json")
	.map((f) => f.replace(".json", ""));

test("there is at least one translation", () => {
	expect(languages.length).toBeGreaterThan(0);
});

for (const lang of languages) {
	test(`${lang}.json matches en.json`, async () => {
		const file = flatten((await import(`./${lang}.json`)).default);
		const keys = new Set([...file.keys()].map(base));
		expect([...sourceKeys].filter((k) => !keys.has(k))).toEqual([]); // missing
		expect([...keys].filter((k) => !sourceKeys.has(k))).toEqual([]); // not in en.json

		for (const [key, text] of file) {
			// Plural keys may differ in form, so compare against any English form of the same message.
			const english = [...source].filter(([k]) => base(k) === base(key));
			const want = new Set(english.flatMap(([, v]) => vars(v)));
			for (const v of vars(text))
				expect(want.has(v), `${lang}: ${key} uses ${v}`).toBe(true);
			if (!PLURAL.test(key))
				expect(vars(text), `${lang}: ${key}`).toEqual(
					vars(source.get(key) ?? ""),
				);
		}
	});
}
