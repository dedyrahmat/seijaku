import {
	buildTree,
	flattenTree,
	type NoteMeta,
	touchNote,
} from "@seijaku/sync";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type * as Y from "yjs";
import { openTodos, type Todo, tickTodo } from "../editor/todos";
import { useNotes } from "../workspace/hooks";
import { workspace } from "../workspace/store";
import { pageLink } from "./pageLink";

interface Group {
	note: NoteMeta;
	todos: Todo[];
}

/** Ticks a to-do in a checklist that is not open. It is opened for editing first, so the change syncs like any edit. */
async function tick(noteId: string, todoId: string) {
	workspace.openNote(noteId);
	await workspace.withFragment(noteId, (f) => {
		(f.doc as Y.Doc).transact(() => {
			tickTodo(f, todoId);
		});
	});
	touchNote(workspace.index, noteId); // moves updatedAt, which refreshes the list
}

/**
 * The mockup's "Today · Still to do": unticked to-dos from your Checklist notes, shown on today's
 * page. Read on this device from each note's content; ticking one ticks it in its checklist.
 */
export function StillToDo() {
	const notes = useNotes();
	const [groups, setGroups] = useState<Group[]>([]);

	// A checklist's updatedAt moves when its content is edited, which is what refreshes this.
	const lists = useMemo(
		() => flattenTree(buildTree(notes)).filter((n) => n.kind === "checklist"),
		[notes],
	);
	const key = lists.map((n) => `${n.id}:${n.updatedAt}`).join(",");

	// biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the lists and their edit times
	useEffect(() => {
		let stale = false;
		void Promise.all(
			lists.map(async (note) => ({
				note,
				todos: await workspace.withFragment(note.id, openTodos),
			})),
		).then((all) => {
			if (!stale) setGroups(all.filter((g) => g.todos.length > 0));
		});
		return () => {
			stale = true;
		};
	}, [key]);

	if (groups.length === 0) return null;
	const left = groups.reduce((n, g) => n + g.todos.length, 0);

	return (
		<section
			aria-labelledby="still-to-do"
			className="mb-6 flex flex-col gap-3.5 rounded-2xl bg-callout px-[22px] py-5"
		>
			<div className="flex items-baseline gap-2.5">
				<h2
					id="still-to-do"
					className="font-serif text-[22px] font-medium tracking-[-0.01em]"
				>
					Still to do
				</h2>
				<span className="text-[13px] text-mute">{left} left</span>
			</div>
			{groups.map((g) => (
				<div key={g.note.id} className="flex flex-col gap-1.5">
					<Link
						{...pageLink(g.note.id, g.note.title)}
						className="self-start text-[13px] text-ink2 underline decoration-mute underline-offset-[3px]"
					>
						{g.note.title || "Untitled"}
					</Link>
					{g.todos.map((t) => (
						<label
							key={t.id}
							className="flex min-h-8 cursor-pointer items-start gap-3 text-base leading-normal"
						>
							<input
								type="checkbox"
								checked={false}
								onChange={() => void tick(g.note.id, t.id)}
								className="mt-1 size-[18px] accent-ink"
							/>
							<span>{t.text}</span>
						</label>
					))}
				</div>
			))}
			<p className="text-xs leading-normal text-mute">
				From your checklists. Tick one here and it is ticked there too.
			</p>
		</section>
	);
}
