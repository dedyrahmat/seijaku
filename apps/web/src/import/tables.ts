/** Small readers for two export formats that become one page each: CSV tables and JSON Canvas boards. */

/** Rows of a CSV file (RFC 4180: quoted cells, doubled quotes, newlines inside quotes). */
export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	const src = text.replace(/^﻿/, "");
	for (let i = 0; i < src.length; i++) {
		const c = src[i] as string;
		if (quoted) {
			if (c === '"' && src[i + 1] === '"') {
				cell += '"';
				i++;
			} else if (c === '"') quoted = false;
			else cell += c;
		} else if (c === '"') quoted = true;
		else if (c === ",") {
			row.push(cell);
			cell = "";
		} else if (c === "\n" || c === "\r") {
			if (c === "\r" && src[i + 1] === "\n") i++;
			row.push(cell);
			rows.push(row);
			row = [];
			cell = "";
		} else cell += c;
	}
	if (cell !== "" || row.length > 0) {
		row.push(cell);
		rows.push(row);
	}
	return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const MAX_ROWS = 1000;

/** A Markdown table, or "" when there is nothing in the file. */
export function csvToMarkdown(text: string): string {
	const rows = parseCsv(text);
	const head = rows[0];
	if (!head) return "";
	const cell = (c: string) => c.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
	const line = (r: string[]) =>
		`| ${head.map((_, i) => cell(r[i] ?? "")).join(" | ")} |`;
	return [
		line(head),
		`| ${head.map(() => "---").join(" | ")} |`,
		...rows.slice(1, MAX_ROWS + 1).map(line),
	].join("\n");
}

interface CanvasNode {
	type?: string;
	text?: string;
	file?: string;
	url?: string;
	label?: string;
	x?: number;
	y?: number;
}

/**
 * An Obsidian canvas as reading-order Markdown: cards top to bottom, then left to right.
 * The layout and the arrows are not kept. Returns "" for an empty or unreadable board.
 */
export function canvasToMarkdown(json: string): string {
	let nodes: CanvasNode[];
	try {
		const parsed = JSON.parse(json) as { nodes?: CanvasNode[] };
		nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
	} catch {
		return "";
	}
	return [...nodes]
		.sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0))
		.map((n) => {
			if (n.type === "text") return (n.text ?? "").trim();
			if (n.type === "file") return n.file ? `*File: ${n.file}*` : "";
			if (n.type === "link") return n.url ? `<${n.url}>` : "";
			if (n.type === "group") return n.label ? `## ${n.label}` : "";
			return "";
		})
		.filter(Boolean)
		.join("\n\n");
}
