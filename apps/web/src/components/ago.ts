/** "just now", "2 minutes ago": how the design words elapsed time. */
export function ago(then: number | null, now: number): string {
	if (!then) return "just now";
	const mins = Math.floor((now - then) / 60_000);
	if (mins < 1) return "just now";
	if (mins === 1) return "1 minute ago";
	if (mins < 60) return `${mins} minutes ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
	const days = Math.floor(hours / 24);
	return days === 1 ? "yesterday" : `${days} days ago`;
}
