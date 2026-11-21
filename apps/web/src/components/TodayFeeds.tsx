import { Link } from "@tanstack/react-router";
import { lazy, Suspense, useMemo } from "react";
import { useNotes } from "../workspace/hooks";
import { isoDay } from "./dates";
import { Icon } from "./Icon";
import { pageLink, quickLink } from "./pageLink";

const StillToDo = lazy(() =>
	import("./StillToDo").then((m) => ({ default: m.StillToDo })),
);

/** What waits for you on Today: unticked to-dos, study notes due for a revisit, and pinned quick notes. */
export function TodayFeeds() {
	const notes = useNotes();
	const today = isoDay(new Date());
	const revisit = useMemo(
		() =>
			notes.filter((n) => {
				const on = n.fields.study?.revisitOn;
				return (
					n.kind === "study" &&
					!n.trashed &&
					typeof on === "string" &&
					on <= today
				);
			}),
		[notes, today],
	);
	const pinned = useMemo(
		() =>
			notes.filter(
				(n) =>
					n.kind === "quick" && !n.trashed && n.fields.quick?.pinned === true,
			),
		[notes],
	);
	return (
		<>
			<Suspense fallback={null}>
				<StillToDo />
			</Suspense>
			{revisit.length > 0 ? (
				<Feed title="To revisit" icon="history">
					{revisit.map((n) => (
						<Link key={n.id} {...pageLink(n.id, n.title)} className="feed-row">
							{n.title || "Untitled"}
							<span className="text-xs text-mute">
								{String(n.fields.study?.revisitOn)}
							</span>
						</Link>
					))}
				</Feed>
			) : null}
			{pinned.length > 0 ? (
				<Feed title="Pinned" icon="pin">
					{pinned.map((n) => (
						<Link key={n.id} {...quickLink(n.id, n.title)} className="feed-row">
							{n.title || "Quick note"}
						</Link>
					))}
				</Feed>
			) : null}
		</>
	);
}

function Feed({
	title,
	icon,
	children,
}: {
	title: string;
	icon: "history" | "pin";
	children: React.ReactNode;
}) {
	return (
		<section className="mb-6 flex flex-col gap-1 rounded-2xl border border-line2 px-[22px] py-4">
			<h2 className="mb-1 flex items-center gap-2 font-serif text-lg font-medium">
				<Icon name={icon} size={15} className="text-mute" />
				{title}
			</h2>
			{children}
		</section>
	);
}
