/**
 * Dev script: bun apps/web/scripts/icon-packs.ts
 * Pulls the icons the app uses out of the four Iconify packs (dev dependencies) into
 * src/components/iconPacks.generated.ts, so the app ships only those few icons.
 * Each icon lists candidate names per pack; the first that exists wins.
 */
import { join } from "node:path";

type Pack = "lucide" | "iconoir" | "ri" | "solar";

const WANT: Record<string, Record<Pack, string[]>> = {
	plus: {
		lucide: ["plus"],
		iconoir: ["plus"],
		ri: ["add-line"],
		solar: ["add-linear", "add-circle-linear"],
	},
	search: {
		lucide: ["search"],
		iconoir: ["search"],
		ri: ["search-line"],
		solar: ["magnifier-linear"],
	},
	today: {
		lucide: ["calendar"],
		iconoir: ["calendar"],
		ri: ["calendar-line"],
		solar: ["calendar-linear"],
	},
	home: {
		lucide: ["house", "home"],
		iconoir: ["home"],
		ri: ["home-4-line", "home-line"],
		solar: ["home-2-linear", "home-linear"],
	},
	trash: {
		lucide: ["trash"],
		iconoir: ["trash"],
		ri: ["delete-bin-line"],
		solar: ["trash-bin-minimalistic-linear", "trash-bin-trash-linear"],
	},
	import: {
		lucide: ["download"],
		iconoir: ["download"],
		ri: ["download-2-line"],
		solar: ["download-minimalistic-linear", "download-linear"],
	},
	export: {
		lucide: ["upload"],
		iconoir: ["upload"],
		ri: ["upload-2-line"],
		solar: ["upload-minimalistic-linear", "upload-linear"],
	},
	settings: {
		lucide: ["settings-2", "sliders-horizontal"],
		iconoir: ["settings"],
		ri: ["equalizer-line", "settings-3-line"],
		solar: ["settings-linear", "tuning-2-linear"],
	},
	folder: {
		lucide: ["folder"],
		iconoir: ["folder"],
		ri: ["folder-line"],
		solar: ["folder-linear"],
	},
	"folder-open": {
		lucide: ["folder-open"],
		iconoir: ["folder"],
		ri: ["folder-open-line"],
		solar: ["folder-open-linear"],
	},
	history: {
		lucide: ["rotate-ccw"],
		iconoir: ["clock-rotate-right"],
		ri: ["history-line"],
		solar: ["history-linear"],
	},
	share: {
		lucide: ["share-2"],
		iconoir: ["share-android", "share"],
		ri: ["share-line"],
		solar: ["share-linear"],
	},
	more: {
		lucide: ["ellipsis"],
		iconoir: ["more-horiz"],
		ri: ["more-line"],
		solar: ["menu-dots-linear"],
	},
	close: {
		lucide: ["x"],
		iconoir: ["xmark"],
		ri: ["close-line"],
		solar: ["close-circle-linear", "close-square-linear"],
	},
	check: {
		lucide: ["check"],
		iconoir: ["check"],
		ri: ["check-line"],
		solar: ["check-read-linear", "check-circle-linear"],
	},
	back: {
		lucide: ["chevron-left"],
		iconoir: ["nav-arrow-left"],
		ri: ["arrow-left-s-line"],
		solar: ["alt-arrow-left-linear"],
	},
	forward: {
		lucide: ["chevron-right"],
		iconoir: ["nav-arrow-right"],
		ri: ["arrow-right-s-line"],
		solar: ["alt-arrow-right-linear"],
	},
	up: {
		lucide: ["chevron-up"],
		iconoir: ["nav-arrow-up"],
		ri: ["arrow-up-s-line"],
		solar: ["alt-arrow-up-linear"],
	},
	down: {
		lucide: ["chevron-down"],
		iconoir: ["nav-arrow-down"],
		ri: ["arrow-down-s-line"],
		solar: ["alt-arrow-down-linear"],
	},
	pin: {
		lucide: ["pin"],
		iconoir: ["pin"],
		ri: ["pushpin-line", "pushpin-2-line"],
		solar: ["pin-linear"],
	},
	palette: {
		lucide: ["palette"],
		iconoir: ["palette"],
		ri: ["palette-line"],
		solar: ["palette-round-linear"],
	},
	sun: {
		lucide: ["sun"],
		iconoir: ["sun-light"],
		ri: ["sun-line"],
		solar: ["sun-linear"],
	},
	cloud: {
		lucide: ["cloud"],
		iconoir: ["cloud"],
		ri: ["cloud-line"],
		solar: ["cloud-linear"],
	},
	rain: {
		lucide: ["cloud-rain"],
		iconoir: ["rain"],
		ri: ["rainy-line"],
		solar: ["cloud-rain-linear"],
	},
	snow: {
		lucide: ["snowflake"],
		iconoir: ["snow"],
		ri: ["snowflake-line"],
		solar: ["snowflake-linear"],
	},
	wind: {
		lucide: ["wind"],
		iconoir: ["wind"],
		ri: ["windy-line"],
		solar: ["wind-linear"],
	},
	clock: {
		lucide: ["clock"],
		iconoir: ["clock"],
		ri: ["time-line"],
		solar: ["clock-circle-linear"],
	},
	place: {
		lucide: ["map-pin"],
		iconoir: ["map-pin"],
		ri: ["map-pin-line"],
		solar: ["map-point-linear"],
	},
	link: {
		lucide: ["link"],
		iconoir: ["link"],
		ri: ["link"],
		solar: ["link-linear", "link-round-linear"],
	},
	flag: {
		lucide: ["flag"],
		iconoir: ["bookmark"],
		ri: ["flag-line"],
		solar: ["flag-linear"],
	},
	tag: {
		lucide: ["tag"],
		iconoir: ["label"],
		ri: ["price-tag-3-line"],
		solar: ["tag-linear"],
	},
	lock: {
		lucide: ["lock"],
		iconoir: ["lock"],
		ri: ["lock-line"],
		solar: ["lock-keyhole-linear", "lock-linear"],
	},
	cloudsync: {
		lucide: ["cloud-upload"],
		iconoir: ["cloud-sync"],
		ri: ["cloud-line"],
		solar: ["cloud-upload-linear"],
	},
	keyboard: {
		lucide: ["keyboard"],
		iconoir: ["key-command"],
		ri: ["keyboard-line"],
		solar: ["keyboard-linear"],
	},
	pen: {
		lucide: ["pen"],
		iconoir: ["edit-pencil"],
		ri: ["pencil-line"],
		solar: ["pen-linear"],
	},
	database: {
		lucide: ["database"],
		iconoir: ["database"],
		ri: ["database-2-line"],
		solar: ["database-linear"],
	},
	info: {
		lucide: ["info"],
		iconoir: ["info-circle"],
		ri: ["information-line"],
		solar: ["info-circle-linear"],
	},
	wall: {
		lucide: ["layout-dashboard"],
		iconoir: ["view-grid"],
		ri: ["layout-masonry-line", "dashboard-line"],
		solar: ["widget-linear"],
	},
	quick: {
		lucide: ["sticky-note"],
		iconoir: ["post"],
		ri: ["sticky-note-line"],
		solar: ["notes-linear", "sticker-square-linear"],
	},
	page: {
		lucide: ["file-text"],
		iconoir: ["page"],
		ri: ["file-text-line"],
		solar: ["document-text-linear"],
	},
	checklist: {
		lucide: ["list-checks"],
		iconoir: ["check-circle", "list"],
		ri: ["list-check-2", "list-check"],
		solar: ["checklist-minimalistic-linear", "checklist-linear"],
	},
	journal: {
		lucide: ["book-open"],
		iconoir: ["book"],
		ri: ["book-open-line"],
		solar: ["book-linear", "book-2-linear"],
	},
	meeting: {
		lucide: ["users"],
		iconoir: ["group"],
		ri: ["group-line"],
		solar: ["users-group-rounded-linear"],
	},
	study: {
		lucide: ["graduation-cap"],
		iconoir: ["graduation-cap"],
		ri: ["graduation-cap-line"],
		solar: ["square-academic-cap-linear", "square-academic-cap-2-linear"],
	},
};

const root = join(import.meta.dir, "..", "node_modules", "@iconify-json");
const out: Record<string, Record<string, string>> = {};
let missing = 0;
for (const pack of ["lucide", "iconoir", "ri", "solar"] as Pack[]) {
	const icons = (await Bun.file(join(root, pack, "icons.json")).json())
		.icons as Record<string, { body: string }>;
	out[pack] = {};
	for (const [name, want] of Object.entries(WANT)) {
		const hit = want[pack].find((c) => icons[c]);
		if (!hit) {
			console.log(`missing ${pack}: ${name} (${want[pack].join(", ")})`);
			missing++;
			continue;
		}
		out[pack][name] = icons[hit]?.body ?? "";
	}
}
if (missing) process.exit(1);
await Bun.write(
	join(import.meta.dir, "..", "src", "components", "iconPacks.generated.ts"),
	`// Generated by apps/web/scripts/icon-packs.ts. Do not edit.\n/* biome-ignore-all lint: generated */\nexport const ICON_PACKS = ${JSON.stringify(out, null, "\t")} as const;\n`,
);
console.log("written");
