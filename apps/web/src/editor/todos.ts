import * as Y from "yjs";
import { type Block, fragmentBlocks } from "./headless";

export interface Todo {
	/** The block's id inside its note, to tick it later. */
	id: string;
	text: string;
	/** ISO date or "". */
	due: string;
	high: boolean;
	owner: string;
}

function textOf(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.map((c: { type?: string; text?: string; content?: unknown }) =>
			c.type === "text" ? (c.text ?? "") : textOf(c.content),
		)
		.join("")
		.trim();
}

/** The to-dos in a note that are not ticked yet and have some text. */
export function openTodos(fragment: Y.XmlFragment): Todo[] {
	const out: Todo[] = [];
	const walk = (blocks: Block[]) => {
		for (const b of blocks) {
			const text = textOf(b.content);
			if (b.type === "checkListItem" && !b.props.checked && text)
				out.push({
					id: (b as Block & { id: string }).id,
					text,
					due: typeof b.props.due === "string" ? b.props.due : "",
					high: b.props.priority === "high",
					owner: typeof b.props.owner === "string" ? b.props.owner : "",
				});
			walk(b.children);
		}
	};
	walk(fragmentBlocks(fragment));
	return out;
}

function findContainer(
	node: Y.XmlFragment | Y.XmlElement,
	id: string,
): Y.XmlElement | null {
	for (const child of node.toArray()) {
		if (!(child instanceof Y.XmlElement)) continue;
		if (child.nodeName === "blockContainer" && child.getAttribute("id") === id)
			return child;
		const hit = findContainer(child, id);
		if (hit) return hit;
	}
	return null;
}

/** Ticks a to-do inside a note's content without opening the note. False if it is not found. */
export function tickTodo(fragment: Y.XmlFragment, id: string): boolean {
	const item = findContainer(fragment, id)
		?.toArray()
		.find(
			(c): c is Y.XmlElement =>
				c instanceof Y.XmlElement && c.nodeName === "checkListItem",
		);
	if (!item) return false;
	(item as { setAttribute(name: string, value: unknown): void }).setAttribute(
		"checked",
		true,
	);
	return true;
}

/** How many to-dos a note has and how many are ticked (empty ones do not count). */
export function todoCounts(fragment: Y.XmlFragment): {
	done: number;
	total: number;
} {
	let done = 0;
	let total = 0;
	const walk = (blocks: Block[]) => {
		for (const b of blocks) {
			if (b.type === "checkListItem" && textOf(b.content)) {
				total++;
				if (b.props.checked) done++;
			}
			walk(b.children);
		}
	};
	walk(fragmentBlocks(fragment));
	return { done, total };
}
