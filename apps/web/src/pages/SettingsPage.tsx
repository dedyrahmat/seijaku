import { useEffect, useState } from "react";
import { useHomeScreenNotice, useSyncState } from "../workspace/hooks";
import { savedServerUrl, saveServerUrl } from "../workspace/syncUrl";

const STATUS = {
	synced: "Connected and up to date.",
	syncing: "Connected, catching up.",
	offline: "Not connected. Your notes are saved on this device.",
} as const;

/** The design has no Settings board yet, so this stays small and uses the Trash page's layout. */
export function SettingsPage() {
	const sync = useSyncState();
	const keepSafe = useHomeScreenNotice();
	const [server, setServer] = useState(savedServerUrl);
	const [saved, setSaved] = useState(false);

	useEffect(() => {
		document.title = "Settings · Seijaku";
	}, []);

	return (
		<div className="mx-auto flex w-full max-w-[760px] flex-col gap-8 px-5 pt-10 pb-24 md:pt-[72px]">
			<div className="flex flex-col gap-2">
				<h1 className="font-serif text-[40px] leading-[1.1] font-medium tracking-[-0.015em]">
					Settings
				</h1>
				<p className="text-[15px] text-ink2">Where your notes sync to.</p>
			</div>

			<section className="flex flex-col gap-3 border-t border-line2 pt-6">
				<h2 className="text-[11px] font-medium tracking-[0.09em] text-mute uppercase">
					Server
				</h2>
				<label htmlFor="server" className="text-[15px]">
					Server address
				</label>
				<div className="flex flex-wrap gap-3">
					<input
						id="server"
						value={server}
						onChange={(e) => {
							setServer(e.target.value);
							setSaved(false);
						}}
						placeholder="This site (default)"
						inputMode="url"
						autoComplete="off"
						spellCheck={false}
						className="h-11 min-w-0 flex-1 basis-64 rounded-[14px] border border-line bg-raised px-3.5 text-[15px] text-ink outline-none placeholder:text-mute focus:border-mute md:h-10"
					/>
					<button
						type="button"
						onClick={() => {
							saveServerUrl(server);
							setSaved(true);
							// The connection is made once at start-up; reload to use the new address.
							setTimeout(() => location.reload(), 400);
						}}
						className="h-11 rounded-[14px] bg-ink px-5 text-sm font-medium text-paper hover:opacity-90 md:h-10"
					>
						{saved ? "Saved" : "Save"}
					</button>
				</div>
				<p className="text-[13px] text-mute">
					Leave empty to use the server that gave you this page.{" "}
					{STATUS[sync.status]}
				</p>
			</section>

			<section className="flex flex-col gap-3 border-t border-line2 pt-6">
				<h2 className="text-[11px] font-medium tracking-[0.09em] text-mute uppercase">
					Storage
				</h2>
				<p className="text-[15px]">
					{keepSafe
						? "This browser may clear stored notes when space runs low. Add Seijaku to your Home Screen so the copy on this device is kept."
						: "Every page is stored on this device first, then sent to your server."}
				</p>
			</section>
		</div>
	);
}
