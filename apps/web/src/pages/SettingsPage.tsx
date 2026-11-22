import { useNavigate, useParams, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AboutRow } from "../components/AboutDialogs";
import {
	AccountRow,
	DevicesGroup,
	PasskeysGroup,
	RecoveryGroup,
	SignOutEverywhere,
	useSignedOut,
} from "../components/AccountSettings";
import { ago } from "../components/ago";
import { CaptureTarget } from "../components/CaptureTarget";
import { DeleteAccount } from "../components/DeleteAccount";
import {
	ClearCache,
	ManageLinks,
	WorkspaceNameField,
} from "../components/DeviceSettings";
import { Icon, type IconName } from "../components/Icon";
import { IconPackPicker } from "../components/IconPackPicker";
import { Logo } from "../components/Logo";
import { usePrefLabels } from "../components/prefLabels";
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
import {
	captureShortcut,
	type DesktopSettings,
	desktopSettings,
	isDesktop,
	setCaptureShortcut,
	setDesktopSetting,
	updateApp,
} from "../desktop";
import { exportWorkspace } from "../export";
import { i18n, LANGUAGES, languageOf } from "../i18n";
import { ACCENTS, type Prefs, setPref, usePrefs } from "../preferences";
import { useHomeScreenNotice, useSyncState } from "../workspace/hooks";
import { workspace } from "../workspace/store";
import { savedServerUrl, saveServerUrl } from "../workspace/syncUrl";

const SECTIONS = [
	"general",
	"appearance",
	"editor",
	"sync",
	"security",
	"shortcuts",
	"data",
	"about",
] as const;

type SectionId = (typeof SECTIONS)[number];

const SECTION_ICONS: Record<string, IconName> = {
	general: "home",
	appearance: "palette",
	editor: "pen",
	sync: "cloudsync",
	security: "lock",
	shortcuts: "keyboard",
	data: "database",
	about: "info",
};

/** The mockup's Settings boards: a dialog over the app, sections down the left. */
export function SettingsPage() {
	const { section } = useParams({ strict: false }) as { section?: string };
	const navigate = useNavigate();
	const router = useRouter();
	const { t } = useTranslation();
	const active: SectionId = SECTIONS.find((id) => id === section) ?? "general";
	const title = t(`settings.sections.${active}.name`);
	const blurb = t(`settings.sections.${active}.blurb`);
	const sync = useSyncState();
	const [now, setNow] = useState(() => Date.now());
	const body = useRef<HTMLDivElement>(null);

	useEffect(() => {
		document.title = t("settings.title", { section: title });
		body.current?.scrollTo({ top: 0 });
	}, [title, t]);

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

	const syncedLine = t("settings.synced", {
		when: ago(sync.lastSyncedAt, now),
	});

	return (
		<div className="fixed inset-0 z-50 flex items-stretch justify-center md:items-center">
			<button
				type="button"
				aria-label={t("settings.close")}
				tabIndex={-1}
				onClick={close}
				className="absolute inset-0 bg-scrim"
			/>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={t("settings.name")}
				className="relative flex h-full w-full flex-col overflow-hidden border-line bg-paper text-ink shadow-[0_30px_80px_rgba(40,30,15,0.28),0_2px_8px_rgba(40,30,15,0.1)] md:h-[min(720px,calc(100dvh-48px))] md:w-[min(1040px,calc(100vw-48px))] md:flex-row md:rounded-2xl md:border"
			>
				<nav
					aria-label={t("settings.sectionsLabel")}
					className="flex flex-none flex-col border-b border-line bg-panel pt-[env(safe-area-inset-top)] md:min-h-0 md:w-60 md:border-r md:border-b-0 md:px-3.5 md:pt-6 md:pb-[18px]"
				>
					<h2 className="hidden px-3 pb-4 font-serif text-[26px] font-medium tracking-[-0.01em] md:block">
						{t("settings.name")}
					</h2>
					<div className="flex gap-0.5 overflow-x-auto px-2 py-2 md:min-h-0 md:flex-1 md:flex-col md:overflow-x-hidden md:overflow-y-auto md:p-0">
						{SECTIONS.map((id) => {
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
									className={`flex h-11 flex-none items-center gap-2.5 rounded-full px-3 text-left text-sm whitespace-nowrap md:h-10 md:w-full ${on ? "bg-hover font-semibold text-ink" : "font-medium text-ink2 hover:bg-hover/60"}`}
								>
									<Icon
										name={SECTION_ICONS[id] ?? "info"}
										className={on ? "text-accent" : "text-mute"}
									/>
									{t(`settings.sections.${id}.name`)}
								</button>
							);
						})}
					</div>
					<div className="hidden h-3 flex-none md:block" />
					<p className="hidden px-3 text-xs leading-normal text-mute md:block">
						{t("settings.navFooter", { where: t("settings.about.where.web") })}
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
							aria-label={t("settings.close")}
							onClick={close}
							className="flex size-11 flex-none items-center justify-center rounded-full text-ink2 hover:bg-hover md:size-10"
						>
							<Icon name="close" size={18} />
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
const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
const MOD = isMac ? "⌘" : "Ctrl";
const ALT = isMac ? "⌥" : "Alt";
const SHIFT = isMac ? "⇧" : "Shift";

function General() {
	const { p, set } = useSet();
	const labels = usePrefLabels();
	const { t } = useTranslation();
	const [desktop, setDesktop] = useState<DesktopSettings | null>(null);
	useEffect(() => {
		if (isDesktop) void desktopSettings().then(setDesktop);
	}, []);
	const changeDesktop = (key: keyof DesktopSettings, on: boolean) => {
		if (!desktop) return;
		setDesktop({ ...desktop, [key]: on });
		// Put the switch back if the shell refused (for example the OS blocked autostart).
		setDesktopSetting(key, on).catch(() => setDesktop(desktop));
	};
	return (
		<>
			<Group name={t("settings.general.workspace")}>
				<Row
					label={t("settings.general.workspaceName.label")}
					desc={t("settings.general.workspaceName.desc")}
				>
					<WorkspaceNameField />
				</Row>
				<Row
					label={t("settings.general.language.label")}
					desc={t("settings.general.language.desc")}
				>
					<Select
						label={t("settings.general.language.label")}
						value={languageOf(p.language)}
						options={LANGUAGES}
						labels={Object.fromEntries(
							LANGUAGES.map((l) => [l, t(`language.${l}`)]),
						)}
						onChange={set("language")}
					/>
				</Row>
				<Row
					label={t("settings.general.openOnStart.label")}
					desc={t("settings.general.openOnStart.desc")}
				>
					<Select
						label={t("settings.general.openOnStart.label")}
						value={p.openOnStart}
						options={["Today", "Last page", "Home"]}
						labels={labels.openOnStart}
						onChange={set("openOnStart")}
					/>
				</Row>
			</Group>
			<Group name={t("settings.general.quickCapture")}>
				{isDesktop ? (
					<CaptureShortcut />
				) : (
					<Row
						label={t("settings.general.globalShortcut")}
						note={t("common.desktopApp")}
					>
						<Keys keys={[MOD, ALT, "Space"]} />
					</Row>
				)}
				<Row
					label={t("settings.general.captureTo.label")}
					desc={t("settings.general.captureTo.desc")}
				>
					<CaptureTarget className="h-9 max-w-[220px] pr-3.5 pl-3.5 text-[13px]" />
				</Row>
				<Row
					label={t("settings.general.onTop.label")}
					desc={t("settings.general.onTop.desc")}
					note={isDesktop ? undefined : t("common.desktopApp")}
				>
					<Toggle
						label={t("settings.general.onTop.label")}
						on={desktop?.captureOnTop ?? false}
						onChange={(v) => changeDesktop("captureOnTop", v)}
						disabled={!desktop}
					/>
				</Row>
			</Group>
			<Group name={t("common.desktopApp")}>
				<Row
					label={t("settings.general.launch.label")}
					desc={t("settings.general.launch.desc")}
					note={isDesktop ? undefined : t("common.desktopApp")}
				>
					<Toggle
						label={t("settings.general.launch.label")}
						on={desktop?.launchAtLogin ?? false}
						onChange={(v) => changeDesktop("launchAtLogin", v)}
						disabled={!desktop}
					/>
				</Row>
				<Row
					label={t("settings.general.tray.label")}
					desc={t("settings.general.tray.desc")}
					note={isDesktop ? undefined : t("common.desktopApp")}
				>
					<Toggle
						label={t("settings.general.tray.label")}
						on={desktop?.keepInTray ?? false}
						onChange={(v) => changeDesktop("keepInTray", v)}
						disabled={!desktop}
					/>
				</Row>
			</Group>
		</>
	);
}

function Appearance() {
	const { t } = useTranslation();
	const { p, set } = useSet();
	return (
		<>
			<Group name={t("settings.appearance.theme")}>
				<Row
					label={t("settings.appearance.colourTheme.label")}
					desc={t("settings.appearance.colourTheme.desc")}
				>
					<Segmented
						label={t("settings.appearance.colourTheme.label")}
						value={p.theme}
						options={["light", "dark", "system"]}
						labels={{
							light: t("settings.appearance.light"),
							dark: t("settings.appearance.dark"),
							system: t("settings.appearance.system"),
						}}
						onChange={set("theme")}
					/>
				</Row>
				<Row
					label={t("settings.appearance.accent.label")}
					desc={t("settings.appearance.accent.desc")}
				>
					<Swatches
						label={t("settings.appearance.accent.label")}
						value={p.accent}
						onChange={set("accent")}
						options={(Object.keys(ACCENTS) as Prefs["accent"][]).map((id) => ({
							id,
							label: t(`accent.${id}`),
							color: `var(--swatch-${id})`,
						}))}
					/>
				</Row>
			</Group>
			<Group name={t("settings.appearance.icons.title")}>
				<IconPackPicker />
			</Group>
			<Group name={t("settings.appearance.reading")}>
				<Row
					label={t("settings.appearance.textSize.label")}
					desc={t("settings.appearance.textSize.desc")}
				>
					<Range
						label={t("settings.appearance.textSize.label")}
						value={p.textSize}
						min={14}
						max={22}
						onChange={set("textSize")}
					/>
				</Row>
				<Row
					label={t("settings.appearance.pageWidth.label")}
					desc={t("settings.appearance.pageWidth.desc")}
				>
					<Segmented
						label={t("settings.appearance.pageWidth.label")}
						value={p.pageWidth}
						options={["narrow", "comfortable", "wide"]}
						labels={{
							narrow: t("settings.appearance.narrow"),
							comfortable: t("settings.appearance.comfortable"),
							wide: t("settings.appearance.wide"),
						}}
						onChange={set("pageWidth")}
					/>
				</Row>
				<Row label={t("settings.appearance.lineSpacing")}>
					<Segmented
						label={t("settings.appearance.lineSpacing")}
						value={p.lineSpacing}
						options={["tight", "relaxed", "airy"]}
						labels={{
							tight: t("settings.appearance.tight"),
							relaxed: t("settings.appearance.relaxed"),
							airy: t("settings.appearance.airy"),
						}}
						onChange={set("lineSpacing")}
					/>
				</Row>
				<Row
					label={t("settings.appearance.headingFont.label")}
					desc={t("settings.appearance.headingFont.desc")}
				>
					<Select
						label={t("settings.appearance.headingFont.label")}
						value={p.headingFont}
						options={["Newsreader", "Hanken Grotesk"]}
						onChange={set("headingFont")}
					/>
				</Row>
			</Group>
			<Group name={t("settings.appearance.motion")}>
				<Row
					label={t("settings.appearance.reduceMotion.label")}
					desc={t("settings.appearance.reduceMotion.desc")}
				>
					<Toggle
						label={t("settings.appearance.reduceMotion.label")}
						on={p.reduceMotion}
						onChange={set("reduceMotion")}
					/>
				</Row>
			</Group>
		</>
	);
}

function EditorSettings() {
	const { t } = useTranslation();
	const { p, set } = useSet();
	const labels = usePrefLabels();
	return (
		<>
			<Group name={t("settings.editor.writing")}>
				<Row
					label={t("settings.editor.markdown.label")}
					desc={t("settings.editor.markdown.desc")}
					note={t("common.alwaysOn")}
				>
					<Toggle
						label={t("settings.editor.markdown.label")}
						on={p.markdownShortcuts}
						onChange={set("markdownShortcuts")}
						disabled
					/>
				</Row>
				<Row
					label={t("settings.editor.smart.label")}
					desc={t("settings.editor.smart.desc")}
				>
					<Toggle
						label={t("settings.editor.smart.label")}
						on={p.smartPunctuation}
						onChange={set("smartPunctuation")}
					/>
				</Row>
				<Row
					label={t("settings.editor.spell.label")}
					desc={t("settings.editor.spell.desc")}
				>
					<Toggle
						label={t("settings.editor.spell.label")}
						on={p.spellcheck}
						onChange={set("spellcheck")}
					/>
				</Row>
				<Row label={t("settings.editor.autoPair")}>
					<Toggle
						label={t("settings.editor.autoPair")}
						on={p.autoPair}
						onChange={set("autoPair")}
					/>
				</Row>
				<Row
					label={t("settings.editor.paste.label")}
					desc={t("settings.editor.paste.desc")}
				>
					<Select
						label={t("settings.editor.paste.label")}
						value={p.pasteStyle}
						options={["Match page style", "Plain text"]}
						labels={labels.pasteStyle}
						onChange={set("pasteStyle")}
					/>
				</Row>
			</Group>
			<Group name={t("settings.editor.blocks")}>
				<Row
					label={t("settings.editor.handles.label")}
					desc={t("settings.editor.handles.desc")}
				>
					<Toggle
						label={t("settings.editor.handles.label")}
						on={p.blockHandles}
						onChange={set("blockHandles")}
					/>
				</Row>
				<Row
					label={t("settings.editor.math.label")}
					desc={t("settings.editor.math.desc")}
					note={t("common.alwaysOn")}
				>
					<Toggle
						label={t("settings.editor.math.label")}
						on={p.renderMath}
						onChange={set("renderMath")}
						disabled
					/>
				</Row>
				<Row
					label={t("settings.editor.codeFont.label")}
					desc={t("settings.editor.codeFont.desc")}
				>
					<Select
						label={t("settings.editor.codeFont.label")}
						value={p.codeFont}
						options={["JetBrains Mono", "System mono"]}
						labels={labels.codeFont}
						onChange={set("codeFont")}
					/>
				</Row>
			</Group>
		</>
	);
}

function SyncSettings({ syncedLine }: { syncedLine: string }) {
	const { t } = useTranslation();
	const { p, set } = useSet();
	const labels = usePrefLabels();
	const sync = useSyncState();
	const signedOut = useSignedOut();
	const keepSafe = useHomeScreenNotice();
	const [server, setServer] = useState(savedServerUrl);
	const [saved, setSaved] = useState(false);
	const [tested, setTested] = useState(false);

	const connection =
		sync.status === "offline"
			? t("settings.sync.notConnected")
			: sync.status === "syncing"
				? t("settings.sync.catchingUp")
				: t("settings.sync.upToDate");

	return (
		<>
			<Group name={t("settings.sync.server")}>
				<Row
					label={t("settings.sync.address.label")}
					desc={t("settings.sync.address.desc")}
				>
					<TextField
						label={t("settings.sync.address.label")}
						value={server}
						onChange={(v) => {
							setServer(v);
							setSaved(false);
						}}
						placeholder={t("settings.sync.address.placeholder")}
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
						className="h-9 rounded-full bg-ink px-[18px] text-[13px] font-semibold text-paper hover:opacity-90"
					>
						{saved ? t("common.saved") : t("common.save")}
					</button>
				</Row>
				<Row
					label={t("settings.sync.connection.label")}
					desc={
						keepSafe
							? t("settings.sync.connection.keepSafe")
							: t("settings.sync.connection.desc")
					}
					note={tested || sync.status !== "offline" ? connection : undefined}
				>
					<Btn
						onClick={() => {
							setTested(true);
							workspace.sync.reconnectNow();
						}}
					>
						{t("settings.sync.test")}
					</Btn>
				</Row>
			</Group>
			<Group name={t("settings.sync.syncing")}>
				<Row
					label={t("settings.sync.sync.label")}
					desc={t("settings.sync.sync.desc")}
					note={syncedLine}
				>
					<Btn
						onClick={() => workspace.sync.reconnectNow()}
						disabled={p.workOffline}
					>
						{t("settings.sync.syncNow")}
					</Btn>
				</Row>
				<Row
					label={t("settings.sync.offline.label")}
					desc={t("settings.sync.offline.desc")}
				>
					<Toggle
						label={t("settings.sync.offline.label")}
						on={p.workOffline}
						onChange={(v) => {
							set("workOffline")(v);
							if (v) workspace.sync.stop();
							else workspace.sync.start();
						}}
					/>
				</Row>
				<Row
					label={t("settings.sync.collide.label")}
					desc={t("settings.sync.collide.desc")}
				>
					<Select
						label={t("settings.sync.collide.label")}
						value={p.collisions}
						options={["Keep as a copy", "Keep the newer one"]}
						labels={labels.collisions}
						onChange={set("collisions")}
						disabled
					/>
				</Row>
			</Group>
			{signedOut ? (
				<Group name={t("settings.account")}>
					<AccountRow />
				</Group>
			) : (
				<DevicesGroup />
			)}
		</>
	);
}

function deviceName(): string {
	const ua = navigator.userAgent;
	if (/iPhone|iPad/.test(ua)) return "iPhone";
	if (/Android/.test(ua)) return "Android";
	if (/Mac/.test(ua)) return "Mac";
	if (/Windows/.test(ua)) return i18n.t("settings.device.windows");
	if (/Linux/.test(ua)) return i18n.t("settings.device.linux");
	return i18n.t("settings.device.other");
}

function Security() {
	const { t } = useTranslation();
	const { p, set } = useSet();
	const labels = usePrefLabels();
	const signedOut = useSignedOut();
	return (
		<>
			{signedOut ? (
				<Group name={t("settings.account")}>
					<AccountRow />
				</Group>
			) : (
				<PasskeysGroup deviceName={deviceName()} />
			)}
			<Group name={t("settings.security.recoveryLock")}>
				{signedOut ? null : <RecoveryGroup />}
				<Row
					label={t("settings.security.lock.label")}
					desc={t("settings.security.lock.desc")}
					note={signedOut ? t("common.needsAccount") : undefined}
				>
					<Select
						label={t("settings.security.lock.label")}
						value={p.lockAfterIdle}
						options={["5 minutes", "15 minutes", "Never"]}
						labels={labels.lockAfterIdle}
						onChange={set("lockAfterIdle")}
						disabled={signedOut}
					/>
				</Row>
			</Group>
			<Group name={t("settings.security.danger")}>
				{signedOut ? null : <SignOutEverywhere />}
				<DeleteAccount disabled={signedOut} />
			</Group>
		</>
	);
}

/** Desktop only: the global hotkey that opens the capture window, as Tauri writes it (CommandOrControl+Alt+Space). */
function CaptureShortcut() {
	const { t } = useTranslation();
	const [value, setValue] = useState("");
	const [note, setNote] = useState<string | undefined>();
	useEffect(() => {
		void captureShortcut().then(setValue);
	}, []);
	return (
		<Row
			label={t("settings.general.quickCapture")}
			desc={t("settings.shortcuts.captureDesc")}
			note={note}
		>
			<TextField
				label={t("settings.shortcuts.captureLabel")}
				value={value}
				onChange={(v) => {
					setValue(v);
					setNote(undefined);
				}}
				width="w-[240px]"
			/>
			<Btn
				onClick={() =>
					void setCaptureShortcut(value.trim()).then(
						() => setNote(t("common.saved")),
						(err) => setNote(String(err)),
					)
				}
			>
				{t("common.save")}
			</Btn>
		</Row>
	);
}

function Shortcuts() {
	const { t } = useTranslation();
	return (
		<>
			<Group name={t("settings.shortcuts.navigate")}>
				<Row label={t("settings.shortcuts.switcher")}>
					<Keys keys={[MOD, "K"]} />
				</Row>
				<Row label={t("settings.shortcuts.searchAll")}>
					<Keys keys={[MOD, SHIFT, "F"]} />
				</Row>
				<Row label={t("settings.shortcuts.sidebar")}>
					<Keys keys={[MOD, "\\"]} />
				</Row>
				<Row
					label={t("settings.shortcuts.today")}
					desc={
						isDesktop || isStandalone
							? undefined
							: t("settings.shortcuts.todayNote")
					}
				>
					<Keys keys={[MOD, SHIFT, "T"]} />
				</Row>
			</Group>
			<Group name={t("settings.shortcuts.write")}>
				<Row
					label={t("settings.shortcuts.newPage")}
					desc={
						isDesktop || isStandalone
							? undefined
							: t("settings.shortcuts.newPageNote")
					}
				>
					<Keys keys={[MOD, "N"]} />
				</Row>
				{isDesktop ? (
					<CaptureShortcut />
				) : (
					<Row
						label={t("settings.general.quickCapture")}
						note={t("common.desktopApp")}
					>
						<Keys keys={[MOD, ALT, "Space"]} />
					</Row>
				)}
				<Row label={t("settings.shortcuts.block")}>
					<Keys keys={["/"]} />
				</Row>
				<Row label={t("settings.shortcuts.history")}>
					<Keys keys={[MOD, SHIFT, "H"]} />
				</Row>
				<Row label={t("settings.shortcuts.theme")}>
					<Keys keys={[MOD, SHIFT, "L"]} />
				</Row>
			</Group>
		</>
	);
}

function DataSettings() {
	const { t } = useTranslation();
	const { p, set } = useSet();
	const labels = usePrefLabels();
	const navigate = useNavigate();
	const [exporting, setExporting] = useState<"idle" | "busy" | "failed">(
		"idle",
	);
	return (
		<>
			<Group name={t("settings.data.importExport")}>
				<Row
					label={t("settings.data.import.label")}
					desc={t("settings.data.import.desc")}
				>
					<Btn onClick={() => void navigate({ to: "/import" })}>
						{t("settings.data.import.button")}
					</Btn>
				</Row>
				<Row
					label={t("settings.data.export.label")}
					desc={t("settings.data.export.desc")}
				>
					<Btn
						disabled={exporting === "busy"}
						onClick={() => {
							setExporting("busy");
							exportWorkspace().then(
								() => setExporting("idle"),
								() => setExporting("failed"),
							);
						}}
					>
						{exporting === "busy"
							? t("settings.data.exporting")
							: exporting === "failed"
								? t("settings.data.tryAgain")
								: t("settings.data.exportAll")}
					</Btn>
				</Row>
			</Group>
			<Group name={t("settings.data.keeping")}>
				<Row
					label={t("settings.data.trash.label")}
					desc={t("settings.data.trash.desc")}
				>
					<Select
						label={t("settings.data.trash.label")}
						value={p.trashAfter}
						options={["After 7 days", "After 30 days", "Never"]}
						labels={labels.trashAfter}
						onChange={(v) => {
							set("trashAfter")(v);
							workspace.sweepTrash();
						}}
					/>
				</Row>
				<Row
					label={t("settings.data.history.label")}
					desc={t("settings.data.history.desc")}
				>
					<Select
						label={t("settings.data.history.label")}
						value={p.historyFor}
						options={["30 days", "90 days", "Forever"]}
						labels={labels.historyFor}
						onChange={set("historyFor")}
					/>
				</Row>
				<ManageLinks />
			</Group>
			<Group name={t("settings.data.onDevice")}>
				<Row
					label={t("settings.data.offline.label")}
					desc={t("settings.data.offline.desc")}
				>
					<ClearCache />
				</Row>
			</Group>
		</>
	);
}

function About() {
	const { t } = useTranslation();
	const [checked, setChecked] = useState(false);
	const [found, setFound] = useState<string | null>(null);
	return (
		<>
			<div className="flex items-center gap-6 pt-6 pb-2">
				<Logo size={96} />
				<div className="flex flex-col gap-1.5">
					<span className="font-serif text-[40px] leading-none font-medium tracking-[-0.01em]">
						Seijaku
					</span>
					<span className="font-serif text-[17px] text-ink2 italic">
						{t("tagline")}
					</span>
					<span className="text-[13px] text-mute">
						{t("settings.versionLine", {
							version: "0.1.0",
							where: t(
								isDesktop
									? "settings.about.where.desktop"
									: "settings.about.where.web",
							),
						})}
					</span>
				</div>
			</div>
			<Group name={t("settings.about.updates")}>
				<Row
					label={t("settings.about.version", { version: "0.1.0" })}
					desc={
						found
							? t("settings.about.installing", { version: found })
							: t("settings.about.latest")
					}
					note={checked ? t("settings.about.checked") : undefined}
				>
					<Btn
						onClick={() => {
							setChecked(true);
							if (isDesktop)
								void updateApp().then(setFound, () => setChecked(false));
							else
								void navigator.serviceWorker
									?.getRegistration()
									.then((r) => r?.update());
						}}
					>
						{t("settings.about.check")}
					</Btn>
				</Row>
				<AboutRow
					doc="news"
					label={t("settings.about.news.label")}
					desc={t("settings.about.news.desc")}
					button={t("common.open")}
				/>
			</Group>
			<Group name={t("settings.about.runs")}>
				<AboutRow
					doc="apps"
					label={t("settings.about.platforms.label")}
					desc={t("settings.about.platforms.desc")}
					button={t("settings.about.platforms.button")}
				/>
			</Group>
			<Group name={t("settings.about.print")}>
				<AboutRow
					doc="privacy"
					label={t("settings.about.privacy.label")}
					desc={t("settings.about.privacy.desc")}
					button={t("settings.about.privacy.button")}
				/>
				<AboutRow
					doc="licences"
					label={t("settings.about.licences.label")}
					desc={t("settings.about.licences.desc")}
					button={t("settings.about.licences.button")}
				/>
				<Row
					label={t("settings.about.feedback.label")}
					desc={t("settings.about.feedback.desc")}
				>
					<a
						href="https://github.com/dedyrahmat/seijaku/issues"
						target="_blank"
						rel="noreferrer"
						className="flex h-9 items-center rounded-full border border-line bg-raised px-4 text-[13px] font-medium text-ink hover:bg-hover"
					>
						{t("settings.about.feedback.button")}
					</a>
				</Row>
			</Group>
		</>
	);
}
