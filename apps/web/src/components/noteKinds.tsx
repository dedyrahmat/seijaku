import type { NoteKind } from "@seijaku/sync";
import { Icon } from "./Icon";

/** The six note types: the mockup's "New note" board copy, its 22-unit card icons, and the short names the rest of the app uses. */
export const NOTE_TYPES: {
	id: NoteKind;
	name: string;
	short: string;
	desc: string;
	icon: string;
}[] = [
	{
		id: "quick",
		name: "Quick note",
		short: "quick note",
		desc: "A sticky note. One thought, a number, a name. Saved the moment you stop typing.",
		icon: "M4 4h14v9l-5 5H4zM18 13h-5v5",
	},
	{
		id: "page",
		name: "Page",
		short: "page",
		desc: "A blank page with a title. Headings, lists, images, anything.",
		icon: "M6 3h7l4 4v12H6zM13 3v4h4M9 11h5M9 14.5h5",
	},
	{
		id: "checklist",
		name: "Checklist",
		short: "checklist",
		desc: "To-dos you can tick off. Unfinished ones show up in Today.",
		icon: "M4 6l1.6 1.6L8.4 4.8M11.5 6.2H18M4 12l1.6 1.6 2.8-2.8M11.5 12.2H18M4.4 17.6h3.4M11.5 17.6H18",
	},
	{
		id: "journal",
		name: "Journal entry",
		short: "journal entry",
		desc: "Dated for today and filed under Journal. One per day, picked up where you left it.",
		icon: "M5 4h11a1 1 0 0 1 1 1v13H6a1 1 0 0 1-1-1zM8 4v14M11 8.5h3.5M11 11.5h3.5",
	},
	{
		id: "meeting",
		name: "Meeting notes",
		short: "meeting notes",
		desc: "Who was there, what was said, and what happens next.",
		icon: "M8 10a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2zM3.5 17.5c0-2.5 2-4.3 4.5-4.3s4.5 1.8 4.5 4.3M14.5 9.6a2.2 2.2 0 1 0 0-4.4M15 13.3c2 .3 3.5 1.9 3.5 4.2",
	},
	{
		id: "study",
		name: "Study note",
		short: "study note",
		desc: "A summary callout up top, then room for maths, code and questions to revisit.",
		icon: "M3 7.5L11 4l8 3.5-8 3.5zM6.5 9.4V14c1.2 1.3 2.8 2 4.5 2s3.3-.7 4.5-2V9.4M19 7.5V12",
	},
];

export function kindOf(kind: NoteKind) {
	return NOTE_TYPES.find((t) => t.id === kind) ?? NOTE_TYPES[1];
}

/** The note type's small glyph, as shown in the sidebar and the switcher. */
export function KindGlyph({
	kind,
	size = 15,
	className,
}: {
	kind: NoteKind;
	size?: number;
	className?: string;
}) {
	return <Icon name={kind} size={size} className={className} />;
}
