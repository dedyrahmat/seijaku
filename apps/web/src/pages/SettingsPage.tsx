import { useNavigate, useParams, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ago } from "../components/ago";
import { Logo } from "../components/Logo";
import {
	Btn,
	Group,
	Keys,
	Range,
	Row,
	Segmented,
	Select,
	Swatches,
	TextField,
	Toggle,
} from "../components/SettingRows";
import { ACCENTS, type Prefs, setPref, usePrefs } from "../preferences";
import { useHomeScreenNotice, useSyncState } from "../workspace/hooks";
import { workspace } from "../workspace/store";
import { savedServerUrl, saveServerUrl } from "../workspace/syncUrl";

const SECTIONS = [
	["general", "General", "Your workspace, language and quick capture."],
	[
		"appearance",
		"Appearance",
		"Quiet by default. Change what you read and write in.",
	],
	["editor", "Editor", "How blocks, markdown and typing behave."],
	[
		"sync",
		"Sync and devices",
		"Where your notes sync to, and who can read them.",
	],
	[
		"security",
		"Security",
		"Keep your notes private and your account recoverable.",
	],
	[
		"shortcuts",
		"Shortcuts",
		"Everything you can do without leaving the keyboard.",
	],
	[
		"data",
		"Data and storage",
		"Bring notes in, take them out, and decide what is kept.",
	],
	["about", "About", "Version, updates and the small print."],
] as const;

type SectionId = (typeof SECTIONS)[number][0];

const SOON = "Not available yet";
const NEEDS_SIGN_IN = "Arrives with sign-in";

/** The mockup's Settings boards: a dialog over the app, sections down the left. */
export function SettingsPage() {
	const { section } = useParams({ strict: false }) as { section?: string };
	const navigate = useNavigate();
	const router = useRouter();
	const active: SectionId =
		SECTIONS.find(([id]) => id === section)?.[0] ?? "general";
	const [, title, blurb] =
		SECTIONS.find(([id]) => id === active) ?? SECTIONS[0];
	const sync = useSyncState();
	const [now, setNow] = useState(() => Date.now());
	const body = useRef<HTMLDivElement>(null);

	useEffect(() => {
		document.title = `${title} · Settings · Seijaku`;
		body.current?.scrollTo({ top: 0 });
	}, [title]);

	useEffect(() => {
		const t = setInterval(() => setNow(Date.now()), 30_000);
		return () => clearInterval(t);
	}, []);

	const close = () => {
		if (window.history.length > 1) router.history.back();
		else void navigate({ to: "/" });
	};

	useEffect(() => {
		const esc = (e: KeyboardEvent) => {
			if (e.key === "Escape") close();
		};
		window.addEventListener("keydown", esc);
		return () => window.removeEventListener("keydown", esc);
		// biome-ignore lint/correctness/useExhaustiveDependencies: close only reads stable router state
	}, [close]);

	const syncedLine = `Synced ${ago(sync.lastSyncedAt, now)}`;

	return (
		<div className="fixed inset-0 z-50 flex items-stretch justify-center md:items-center">
			<button
				type="button"
				aria-label="Close settings"
				tabIndex={-1}
				onClick={close}
				className="absolute inset-0 bg-scrim"
			/>
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Settings"
				className="relative flex h-full w-full flex-col overflow-hidden border-line bg-paper text-ink shadow-[0_30px_80px_rgba(40,30,15,0.28),0_2px_8px_rgba(40,30,15,0.1)] md:h-[min(720px,calc(100dvh-48px))] md:w-[min(1040px,calc(100vw-48px))] md:flex-row md:rounded-[28px] md:border"
			>
				<nav
					aria-label="Settings sections"
					className="flex flex-none flex-col border-b border-line bg-panel pt-[env(safe-area-inset-top)] md:w-60 md:border-r md:border-b-0 md:px-3.5 md:pt-6 md:pb-[18px]"
				>
					<h2 className="hidden px-3 pb-4 font-serif text-[26px] font-medium tracking-[-0.01em] md:block">
						Settings
					</h2>
					<div className="flex gap-0.5 overflow-x-auto px-2 py-2 md:flex-col md:overflow-visible md:p-0">
						{SECTIONS.map(([id, label]) => {
							const on = id === active;
							return (
								<button
									type="button"
									key={id}
									aria-current={on ? "page" : undefined}
									onClick={() =>
										void navigate({
											to: "/settings/$section",
											params: { section: id },
											replace: true,
										})
									}
									className={`h-11 flex-none rounded-[14px] px-3 text-left text-sm whitespace-nowrap md:h-10 md:w-full ${on ? "bg-hover font-semibold text-ink" : "font-medium text-ink2 hover:bg-hover/60"}`}
								>
									{label}
								</button>
							);
						})}
					</div>
					<div className="hidden flex-1 md:block" />
					<p className="hidden px-3 text-xs leading-normal text-mute md:block">
						Seijaku 0.1 · Web
						<br />
						{syncedLine}
					</p>
				</nav>

				<section className="flex min-h-0 min-w-0 flex-1 flex-col">
					<header className="flex h-[76px] flex-none items-center justify-between border-b border-line2 pr-4 pl-5 md:pr-7 md:pl-9">
						<div className="flex min-w-0 flex-col gap-0.5">
							<h2 className="font-serif text-[28px] leading-[1.1] font-medium tracking-[-0.01em]">
								{title}
							</h2>
							<p className="truncate text-[13px] text-mute">{blurb}</p>
						</div>
						<button
							type="button"
							aria-label="Close settings"
							onClick={close}
							className="flex size-11 flex-none items-center justify-center rounded-full text-ink2 hover:bg-hover md:size-10"
						>
							<svg
								width="18"
								height="18"
								viewBox="0 0 18 18"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.6"
								strokeLinecap="round"
								aria-hidden="true"
							>
								<path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />
							</svg>
						</button>
					</header>
					<div
						ref={body}
						className="min-h-0 flex-1 overflow-y-auto px-5 pt-2 pb-5 md:px-9"
					>
						{active === "general" ? <General /> : null}
						{active === "appearance" ? <Appearance /> : null}
						{active === "editor" ? <EditorSettings /> : null}
						{active === "sync" ? (
							<SyncSettings syncedLine={syncedLine} />
						) : null}
						{active === "security" ? <Security /> : null}
						{active === "shortcuts" ? <Shortcuts /> : null}
						{active === "data" ? <DataSettings /> : null}
						{active === "about" ? <About /> : null}
					</div>
				</section>
			</div>
		</div>
	);
}

function useSet() {
	const p = usePrefs();
	const set =
		<K extends keyof Prefs>(k: K) =>
		(v: Prefs[K]) =>
			setPref(k, v);
	return { p, set };
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl";
const ALT = isMac ? "⌥" : "Alt";
const SHIFT = isMac ? "⇧" : "Shift";

function General() {
	const { p, set } = useSet();
	return (
		<>
			<Group name="Workspace">
				<Row
					label="Workspace name"
					desc="Shown in the sidebar and on shared pages."
				>
					<TextField
						label="Workspace name"
						value={p.workspaceName}
						onChange={set("workspaceName")}
						placeholder="My notes"
						disabled
					/>
				</Row>
				<Row
					label="Language"
					desc="Interface language. Your notes are not translated."
				>
					<Select
						label="Language"
						value={p.language}
						options={["English"]}
						onChange={set("language")}
					/>
				</Row>
				<Row
					label="Open on start"
					desc="The page you land on when Seijaku opens."
				>
					<Select
						label="Open on start"
						value={p.openOnStart}
						options={["Today", "Last page", "Home"]}
						onChange={set("openOnStart")}
						disabled
					/>
				</Row>
			</Group>
			<Group name="Quick capture">
				<Row label="Global shortcut" note="Desktop app">
					<Keys keys={[MOD, ALT, "Space"]} />
				</Row>
				<Row
					label="Add captures to"
					desc="Where a quick note lands before you sort it."
				>
					<Select
						label="Add captures to"
						value="Today"
						options={["Today"]}
						onChange={() => {}}
					/>
				</Row>
				<Row
					label="Keep the capture window on top"
					desc="Stays above other apps until you send or dismiss it."
					note="Desktop app"
				>
					<Toggle
						label="Keep the capture window on top"
						on={false}
						onChange={() => {}}
						disabled
					/>
				</Row>
			</Group>
			<Group name="Desktop app">
				<Row
					label="Launch at login"
					desc="Starts quietly in the background so capture is always ready."
					note="Desktop app"
				>
					<Toggle
						label="Launch at login"
						on={false}
						onChange={() => {}}
						disabled
					/>
				</Row>
				<Row
					label="Keep running in the menu bar"
					desc="Closing the window leaves quick capture available."
					note="Desktop app"
				>
					<Toggle
						label="Keep running in the menu bar"
						on={false}
						onChange={() => {}}
						disabled
					/>
				</Row>
			</Group>
		</>
	);
}

function Appearance() {
	const { p, set } = useSet();
	return (
		<>
			<Group name="Theme">
				<Row
					label="Colour theme"
					desc="Washi paper by day, sumi ink by night. System follows your device."
				>
					<Segmented
						label="Colour theme"
						value={p.theme}
						options={["light", "dark", "system"]}
						labels={{ light: "Light", dark: "Dark", system: "System" }}
						onChange={set("theme")}
					/>
				</Row>
				<Row
					label="Accent"
					desc="Used for links, focus and the circle in the logo."
				>
					<Swatches
						label="Accent"
						value={p.accent}
						onChange={set("accent")}
						options={(Object.keys(ACCENTS) as Prefs["accent"][]).map((id) => ({
							id,
							label: ACCENTS[id].label,
							color: `var(--swatch-${id})`,
						}))}
					/>
				</Row>
			</Group>
			<Group name="Reading and writing">
				<Row label="Text size" desc="Body text in the editor.">
					<Range
						label="Text size"
						value={p.textSize}
						min={14}
						max={22}
						onChange={set("textSize")}
					/>
				</Row>
				<Row
					label="Page width"
					desc="How wide a page can grow on large screens."
				>
					<Segmented
						label="Page width"
						value={p.pageWidth}
						options={["narrow", "comfortable", "wide"]}
						labels={{
							narrow: "Narrow",
							comfortable: "Comfortable",
							wide: "Wide",
						}}
						onChange={set("pageWidth")}
					/>
				</Row>
				<Row label="Line spacing">
					<Segmented
						label="Line spacing"
						value={p.lineSpacing}
						options={["tight", "relaxed", "airy"]}
						labels={{ tight: "Tight", relaxed: "Relaxed", airy: "Airy" }}
						onChange={set("lineSpacing")}
					/>
				</Row>
				<Row label="Heading font" desc="Body text always uses Hanken Grotesk.">
					<Select
						label="Heading font"
						value={p.headingFont}
						options={["Newsreader", "Hanken Grotesk"]}
						onChange={set("headingFont")}
					/>
				</Row>
			</Group>
			<Group name="Motion">
				<Row
					label="Reduce motion"
					desc="Removes fades and slides. Follows your system setting by default."
				>
					<Toggle
						label="Reduce motion"
						on={p.reduceMotion}
						onChange={set("reduceMotion")}
					/>
				</Row>
			</Group>
		</>
	);
}

function EditorSettings() {
	const { p, set } = useSet();
	return (
		<>
			<Group name="Writing">
				<Row
					label="Markdown shortcuts"
					desc="Type # for a heading, - for a list, [] for a to-do."
					note="Always on"
				>
					<Toggle
						label="Markdown shortcuts"
						on={p.markdownShortcuts}
						onChange={set("markdownShortcuts")}
						disabled
					/>
				</Row>
				<Row
					label="Smart punctuation"
					desc="Curly quotes, proper dashes and ellipses as you type."
				>
					<Toggle
						label="Smart punctuation"
						on={p.smartPunctuation}
						onChange={set("smartPunctuation")}
						disabled
					/>
				</Row>
				<Row
					label="Spellcheck"
					desc="Underline misspelled words. Runs on your device."
				>
					<Toggle
						label="Spellcheck"
						on={p.spellcheck}
						onChange={set("spellcheck")}
						disabled
					/>
				</Row>
				<Row label="Auto-pair brackets and quotes">
					<Toggle
						label="Auto-pair brackets and quotes"
						on={p.autoPair}
						onChange={set("autoPair")}
						disabled
					/>
				</Row>
				<Row
					label="Paste behaviour"
					desc="What happens when you paste from a web page."
				>
					<Select
						label="Paste behaviour"
						value={p.pasteStyle}
						options={["Match page style", "Plain text"]}
						onChange={set("pasteStyle")}
						disabled
					/>
				</Row>
			</Group>
			<Group name="Blocks">
				<Row
					label="Show block handles on hover"
					desc="Drag handle and add button next to each block."
				>
					<Toggle
						label="Show block handles on hover"
						on={p.blockHandles}
						onChange={set("blockHandles")}
					/>
				</Row>
				<Row
					label="Render math as you type"
					desc="LaTeX between $ signs becomes typeset maths."
					note="Always on"
				>
					<Toggle
						label="Render math as you type"
						on={p.renderMath}
						onChange={set("renderMath")}
						disabled
					/>
				</Row>
				<Row label="Code font" desc="Used in code blocks and inline code.">
					<Select
						label="Code font"
						value={p.codeFont}
						options={["JetBrains Mono", "System mono"]}
						onChange={set("codeFont")}
					/>
				</Row>
			</Group>
		</>
	);
}

function SyncSettings({ syncedLine }: { syncedLine: string }) {
	const { p, set } = useSet();
	const sync = useSyncState();
	const keepSafe = useHomeScreenNotice();
	const [server, setServer] = useState(savedServerUrl);
	const [saved, setSaved] = useState(false);
	const [tested, setTested] = useState(false);

	const connection =
		sync.status === "offline"
			? "Not connected"
			: sync.status === "syncing"
				? "Connected · catching up"
				: "Connected · up to date";

	return (
		<>
			<Group name="Server">
				<Row
					label="Server address"
					desc="Leave empty to use the server that gave you this page. Point it at your own server to self-host."
				>
					<TextField
						label="Server address"
						value={server}
						onChange={(v) => {
							setServer(v);
							setSaved(false);
						}}
						placeholder="This site (default)"
						width="w-[280px]"
					/>
					<button
						type="button"
						onClick={() => {
							saveServerUrl(server);
							setSaved(true);
							// The connection is made once at start-up; reload to use the new address.
							setTimeout(() => location.reload(), 400);
						}}
						className="h-9 rounded-xl bg-ink px-[18px] text-[13px] font-semibold text-paper hover:opacity-90"
					>
						{saved ? "Saved" : "Save"}
					</button>
				</Row>
				<Row
					label="Connection"
					desc={
						keepSafe
							? "This browser may clear stored notes when space runs low. Add Seijaku to your Home Screen so the copy on this device is kept."
							: "Every page is stored on this device first, then sent to your server."
					}
					note={tested || sync.status !== "offline" ? connection : undefined}
				>
					<Btn
						onClick={() => {
							setTested(true);
							workspace.sync.reconnectNow();
						}}
					>
						Test connection
					</Btn>
				</Row>
			</Group>
			<Group name="Syncing">
				<Row
					label="Sync"
					desc="Pull and push changes right now."
					note={syncedLine}
				>
					<Btn
						onClick={() => workspace.sync.reconnectNow()}
						disabled={p.workOffline}
					>
						Sync now
					</Btn>
				</Row>
				<Row
					label="Work offline"
					desc="Pause syncing. Changes queue up and send when you turn this off."
				>
					<Toggle
						label="Work offline"
						on={p.workOffline}
						onChange={(v) => {
							set("workOffline")(v);
							if (v) workspace.sync.stop();
							else workspace.sync.start();
						}}
					/>
				</Row>
				<Row
					label="When two edits collide"
					desc="Both versions are kept. Choose what happens to the older one."
				>
					<Select
						label="When two edits collide"
						value={p.collisions}
						options={["Keep as a copy", "Keep the newer one"]}
						onChange={set("collisions")}
						disabled
					/>
				</Row>
			</Group>
			<Group name="Signed-in devices">
				<Row label={`${deviceName()} · Web`} desc="Active now">
					<Btn disabled>This device</Btn>
				</Row>
				<Row
					label="Other devices"
					desc="Every device with your passkey will be listed here, each with a Sign out."
					note={NEEDS_SIGN_IN}
				>
					<span />
				</Row>
			</Group>
		</>
	);
}

function deviceName(): string {
	const ua = navigator.userAgent;
	if (/iPhone|iPad/.test(ua)) return "iPhone";
	if (/Android/.test(ua)) return "Android";
	if (/Mac/.test(ua)) return "Mac";
	if (/Windows/.test(ua)) return "Windows PC";
	if (/Linux/.test(ua)) return "Linux PC";
	return "This device";
}

function Security() {
	const { p, set } = useSet();
	return (
		<>
			<Group name="Account">
				<Row
					label="Email"
					desc="Used to sign in and to send recovery links."
					note={NEEDS_SIGN_IN}
				>
					<TextField
						label="Email"
						value=""
						onChange={() => {}}
						placeholder="you@example.com"
						disabled
					/>
				</Row>
				<Row
					label="Password"
					desc="Last changed 4 months ago."
					note={NEEDS_SIGN_IN}
				>
					<Btn disabled>Change password</Btn>
				</Row>
				<Row
					label="Two-step sign-in"
					desc="Ask for a code from your authenticator app on new devices."
					note={NEEDS_SIGN_IN}
				>
					<Toggle
						label="Two-step sign-in"
						on={false}
						onChange={() => {}}
						disabled
					/>
				</Row>
			</Group>
			<Group name="Recovery and lock">
				<Row
					label="Recovery codes"
					desc="Eight of ten codes are unused. Keep them somewhere offline."
					note={NEEDS_SIGN_IN}
				>
					<Btn disabled>View codes</Btn>
				</Row>
				<Row
					label="Lock after inactivity"
					desc="Ask for your password or Face ID after you step away."
				>
					<Select
						label="Lock after inactivity"
						value={p.lockAfter}
						options={["5 minutes", "15 minutes", "Never"]}
						onChange={set("lockAfter")}
						disabled
					/>
				</Row>
			</Group>
			<Group name="Danger zone">
				<Row
					label="Sign out everywhere"
					desc="Ends every session, including this one."
					note={NEEDS_SIGN_IN}
				>
					<Btn danger disabled>
						Sign out all
					</Btn>
				</Row>
				<Row
					label="Delete account"
					desc="Removes your notes from every device. Export first."
					note={NEEDS_SIGN_IN}
				>
					<Btn danger disabled>
						Delete…
					</Btn>
				</Row>
			</Group>
		</>
	);
}

function Shortcuts() {
	return (
		<>
			<Group name="Navigate">
				<Row label="Quick switcher">
					<Keys keys={[MOD, "K"]} />
				</Row>
				<Row label="Search all pages">
					<Keys keys={[MOD, SHIFT, "F"]} />
				</Row>
				<Row label="Toggle sidebar">
					<Keys keys={[MOD, "\\"]} />
				</Row>
				<Row label="Go to Today">
					<Keys keys={[MOD, SHIFT, "T"]} />
				</Row>
			</Group>
			<Group name="Write">
				<Row label="New page">
					<Keys keys={[MOD, "N"]} />
				</Row>
				<Row label="Quick capture" note="Desktop app">
					<Keys keys={[MOD, ALT, "Space"]} />
				</Row>
				<Row label="Insert a block">
					<Keys keys={["/"]} />
				</Row>
				<Row label="Version history">
					<Keys keys={[MOD, SHIFT, "H"]} />
				</Row>
				<Row label="Switch light and dark">
					<Keys keys={[MOD, SHIFT, "L"]} />
				</Row>
			</Group>
		</>
	);
}

function DataSettings() {
	const { p, set } = useSet();
	const navigate = useNavigate();
	return (
		<>
			<Group name="Import and export">
				<Row
					label="Import notes"
					desc="From Notion, Obsidian, Markdown files or a Seijaku archive."
				>
					<Btn onClick={() => void navigate({ to: "/import" })}>Import…</Btn>
				</Row>
				<Row
					label="Export everything"
					desc="A zip of Markdown files with your images and attachments."
				>
					<Btn disabled title={SOON}>
						Export all
					</Btn>
				</Row>
			</Group>
			<Group name="Keeping and deleting">
				<Row
					label="Empty trash automatically"
					desc="Deleted pages can be restored until then."
				>
					<Select
						label="Empty trash automatically"
						value={p.trashAfter}
						options={["After 7 days", "After 30 days", "Never"]}
						onChange={set("trashAfter")}
						disabled
					/>
				</Row>
				<Row
					label="Keep version history"
					desc="Older versions are removed to save space."
				>
					<Select
						label="Keep version history"
						value={p.historyFor}
						options={["30 days", "90 days", "Forever"]}
						onChange={set("historyFor")}
						disabled
					/>
				</Row>
				<Row
					label="Public pages"
					desc="Pages shared with a link."
					note={NEEDS_SIGN_IN}
				>
					<Btn disabled>Manage links</Btn>
				</Row>
			</Group>
			<Group name="On this device">
				<Row
					label="Offline storage"
					desc="Notes and images are saved in this browser, so Seijaku works without a connection."
				>
					<Btn disabled title={SOON}>
						Clear cache
					</Btn>
				</Row>
			</Group>
		</>
	);
}

function About() {
	const [checked, setChecked] = useState(false);
	return (
		<>
			<div className="flex items-center gap-6 pt-6 pb-2">
				<Logo size={96} />
				<div className="flex flex-col gap-1.5">
					<span className="font-serif text-[40px] leading-none font-medium tracking-[-0.01em]">
						Seijaku
					</span>
					<span className="font-serif text-[17px] text-ink2 italic">
						Active calm. The opposite of noise.
					</span>
					<span className="text-[13px] text-mute">Version 0.1.0 · Web</span>
				</div>
			</div>
			<Group name="Updates">
				<Row
					label="Version 0.1.0"
					desc="You have the latest version."
					note={checked ? "Checked just now" : undefined}
				>
					<Btn
						onClick={() => {
							setChecked(true);
							void navigator.serviceWorker
								?.getRegistration()
								.then((r) => r?.update());
						}}
					>
						Check for updates
					</Btn>
				</Row>
				<Row label="What's new" desc="Release notes for each version.">
					<Btn disabled title={SOON}>
						Open
					</Btn>
				</Row>
			</Group>
			<Group name="Where it runs">
				<Row
					label="Platforms"
					desc="Web, iPhone Home Screen app and a desktop app share one workspace."
				>
					<Btn disabled title={SOON}>
						Get the apps
					</Btn>
				</Row>
			</Group>
			<Group name="The small print">
				<Row label="Privacy" desc="What is stored, where, and for how long.">
					<Btn disabled title={SOON}>
						Read
					</Btn>
				</Row>
				<Row
					label="Open-source licences"
					desc="The libraries Seijaku is built on."
				>
					<Btn disabled title={SOON}>
						View
					</Btn>
				</Row>
				<Row label="Send feedback" desc="Tell us what felt noisy.">
					<a
						href="https://github.com/dedyrahmat/seijaku/issues"
						target="_blank"
						rel="noreferrer"
						className="flex h-9 items-center rounded-xl border border-line bg-raised px-4 text-[13px] font-medium text-ink hover:bg-hover"
					>
						Write to us
					</a>
				</Row>
			</Group>
		</>
	);
}
