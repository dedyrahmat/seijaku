import { Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	authenticatePasskey,
	createPhraseForNewWorkspace,
	openWithPasskey,
	registerPasskey,
	signInWithPhrase,
	signUpWithPhrase,
	unlockWithPhrase,
} from "../auth/keys";
import { authStore, IDLE_LOCK, useAuth } from "../auth/session";
import { Logo } from "../components/Logo";
import {
	PhraseActions,
	PhraseField,
	PhraseGrid,
} from "../components/RecoveryPhrase";
import { isDesktop, signInInBrowser } from "../desktop";
import { apiUrl, savedServerUrl } from "../workspace/syncUrl";

/**
 * The mockup's Sign-In, Setup and Recovery boards, wired to the server's passkeys and the
 * recovery phrase. The phrase is made on this device like a wallet's; with it (or a passkey on
 * a device that already holds the key) notes open, and without it they cannot.
 */

const PRIMARY =
	"flex h-[50px] w-full items-center justify-center gap-2.5 rounded-2xl bg-ink text-[15px] font-medium text-paper hover:opacity-90 disabled:opacity-40";
const SECONDARY =
	"flex h-[50px] w-full items-center justify-center gap-2.5 rounded-2xl border border-line bg-raised text-[15px] font-medium text-ink hover:bg-hover disabled:opacity-40";

function Page({ children }: { children: ReactNode }) {
	return (
		<div className="flex min-h-dvh items-center justify-center bg-paper px-4 py-8 text-ink">
			<div className="flex min-h-[min(680px,calc(100dvh-64px))] w-full max-w-[560px] flex-col px-4 pt-6 pb-8 sm:px-14 sm:pt-12">
				{children}
			</div>
		</div>
	);
}

function StepHeader({ step }: { step: string }) {
	return (
		<div className="flex items-center gap-2.5">
			<Logo size={26} />
			<span className="font-serif text-xl font-medium">Seijaku</span>
			<div className="flex-1" />
			<span className="text-[13px] text-mute">{step}</span>
		</div>
	);
}

function PasskeyIcon() {
	return (
		<svg
			width="18"
			height="18"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.4"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<circle cx="5.5" cy="8" r="2.8" />
			<path d="M8.3 8H14M12 8v2.5M10 8v1.5" />
		</svg>
	);
}

function PhraseIcon() {
	return (
		<svg
			width="18"
			height="18"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.4"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<rect x="2" y="3" width="12" height="10" rx="2" />
			<path d="M5 6.5h2M9 6.5h2M5 9.5h2M9 9.5h2" />
		</svg>
	);
}

function Notice({ children, error }: { children: ReactNode; error?: boolean }) {
	return (
		<p
			role={error ? "alert" : "status"}
			className={`text-center text-[13px] leading-normal ${error ? "text-accent" : "text-mute"}`}
		>
			{children}
		</p>
	);
}

function message(err: unknown, fallback: string): string {
	return err instanceof Error && err.message ? err.message : fallback;
}

/** Signing in is optional: notes stay on this device until there is an account. */
function KeepWriting() {
	const { t } = useTranslation();
	return (
		<Link
			to="/"
			className="text-center text-[13px] text-mute underline underline-offset-[3px]"
		>
			{t("auth.keepWriting")}
		</Link>
	);
}

export function SignInPage() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const auth = useAuth();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [usePhrase, setUsePhrase] = useState(false);
	const [phrase, setPhrase] = useState("");

	useEffect(() => {
		document.title = t("auth.titleSignIn");
		void authStore.refresh();
	}, [t]);
	useEffect(() => {
		// The browser half of desktop sign-in sends people back to its own page once they are in.
		const next = new URLSearchParams(location.search).get("next");
		if (
			next === "/desktop-link" &&
			auth.phase !== "signed-out" &&
			auth.phase !== "checking"
		)
			void navigate({ to: "/desktop-link" });
		else if (auth.phase === "signed-in") void navigate({ to: "/" });
		else if (auth.phase === "locked") void navigate({ to: "/unlock" });
	}, [auth.phase, navigate]);
	const server = savedServerUrl().replace(/^https?:\/\//, "") || location.host;

	const withPasskey = async () => {
		setBusy(true);
		setError(null);
		try {
			// A passkey that can make its secret opens the notes too; if not, Unlock asks for the phrase.
			await openWithPasskey(await authenticatePasskey());
			await authStore.changed();
		} catch (err) {
			setError(message(err, t("auth.noServerAddress")));
		} finally {
			setBusy(false);
		}
	};

	const withPhrase = async (e: React.FormEvent) => {
		e.preventDefault();
		setBusy(true);
		setError(null);
		try {
			await signInWithPhrase(phrase);
			await authStore.changed();
		} catch (err) {
			setError(message(err, t("auth.badPhrase")));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Page>
			<div className="flex w-full flex-1 flex-col items-center justify-center gap-[18px] text-center">
				<Logo size={72} />
				<div className="flex flex-col items-center gap-1">
					<h1 className="font-serif text-[38px] font-medium tracking-[-0.01em]">
						Seijaku
					</h1>
					<span
						lang="ja"
						className="pl-[0.4em] font-serif text-[15px] tracking-[0.4em] text-mute"
					>
						静寂
					</span>
				</div>
				<p className="font-serif text-lg text-ink2 italic">{t("tagline")}</p>

				<div className="mt-[18px] flex w-full flex-col gap-3.5 text-left">
					{isDesktop ? (
						<button
							type="button"
							disabled={busy}
							onClick={() => {
								setError(null);
								signInInBrowser().catch((err) =>
									setError(message(err, t("auth.noBrowser"))),
								);
							}}
							className={PRIMARY}
						>
							<PasskeyIcon />
							{t("auth.withBrowser")}
						</button>
					) : (
						<button
							type="button"
							disabled={busy}
							onClick={() => void withPasskey()}
							className={PRIMARY}
						>
							<PasskeyIcon />
							{t("auth.withPasskey")}
						</button>
					)}
					{usePhrase ? (
						<form onSubmit={withPhrase} className="flex flex-col gap-2.5">
							<PhraseField
								id="sign-in-phrase"
								value={phrase}
								onChange={setPhrase}
								autoFocus
							/>
							<button
								type="submit"
								disabled={busy || phrase.trim().length < 12}
								className={SECONDARY}
							>
								<PhraseIcon />
								{t("auth.withPhrase")}
							</button>
						</form>
					) : (
						<button
							type="button"
							onClick={() => setUsePhrase(true)}
							className={SECONDARY}
						>
							<PhraseIcon />
							{t("auth.withPhrase")}
						</button>
					)}
					{error ? <Notice error>{error}</Notice> : null}
					{auth.offline ? (
						<div className="flex flex-col items-center gap-2">
							<Notice>{t("auth.noServerSignIn")}</Notice>
							<button
								type="button"
								onClick={() => void authStore.refresh()}
								className="text-[13px] text-ink underline underline-offset-[3px]"
							>
								{t("settings.data.tryAgain")}
							</button>
						</div>
					) : null}
					<Link
						to="/setup"
						className="text-center text-[13px] text-mute underline underline-offset-[3px]"
					>
						{t("auth.newHere")}
					</Link>
					<KeepWriting />
				</div>
			</div>

			<div className="flex w-full items-center justify-center gap-2 border-t border-line2 pt-[18px] text-[13px] text-mute">
				<span>{t("settings.sync.server")}</span>
				<span className="font-mono text-xs text-ink2">{server}</span>
				<Link
					to="/settings/$section"
					params={{ section: "sync" }}
					className="text-ink2 underline underline-offset-[3px]"
				>
					{t("auth.change")}
				</Link>
			</div>
		</Page>
	);
}

export function SetupPage() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const auth = useAuth();
	const [token, setToken] = useState("");
	const [device, setDevice] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const working = useRef(false);

	useEffect(() => {
		document.title = t("auth.titleCreate");
		void authStore.refresh();
	}, [t]);
	useEffect(() => {
		// Already signed in: nothing to create. Not while this page is making the account itself.
		if (working.current) return;
		if (auth.phase === "signed-in") void navigate({ to: "/" });
	}, [auth.phase, navigate]);

	const create = async (how: "passkey" | "phrase") => {
		setBusy(true);
		working.current = true;
		setError(null);
		try {
			if (how === "passkey") {
				const passkey = await registerPasskey({
					name: device.trim() || t("settings.device.other"),
					context: auth.codeRequired ? token : "",
					createSession: true,
				});
				authStore.holdPhrase(await createPhraseForNewWorkspace(passkey));
			} else {
				authStore.holdPhrase(
					await signUpWithPhrase(auth.codeRequired ? token : ""),
				);
			}
			await authStore.changed();
			void navigate({ to: "/recovery-phrase" });
		} catch (err) {
			setError(message(err, t("auth.noServerRetry")));
			working.current = false;
		} finally {
			setBusy(false);
		}
	};

	const field =
		"h-[46px] rounded-2xl border border-line bg-raised px-3.5 text-[15px] text-ink outline-none focus:border-mute";

	return (
		<Page>
			<StepHeader step={t("auth.step1")} />
			<div className="flex flex-1 flex-col justify-center gap-7">
				<div className="flex flex-col gap-2.5">
					<h1 className="font-serif text-4xl leading-[1.12] font-medium tracking-[-0.015em]">
						{t("auth.createHeading")}
					</h1>
					<p className="text-[15px] leading-relaxed text-pretty text-ink2">
						{t("auth.setupIntro")}
					</p>
				</div>
				<div className="flex flex-col gap-[18px]">
					{auth.codeRequired ? (
						<div className="flex flex-col gap-1.5">
							<label htmlFor="setup-token" className="text-[13px] font-medium">
								{t("auth.signupCode")}
							</label>
							<input
								id="setup-token"
								type="password"
								autoComplete="off"
								value={token}
								onChange={(e) => setToken(e.target.value)}
								className={field}
							/>
							<span className="text-xs text-mute">{t("auth.codeNote")}</span>
						</div>
					) : null}
					<div className="flex flex-col gap-1.5">
						<label htmlFor="setup-device" className="text-[13px] font-medium">
							{t("auth.nameDevice")}
						</label>
						<input
							id="setup-device"
							type="text"
							value={device}
							onChange={(e) => setDevice(e.target.value)}
							placeholder={t("auth.devicePlaceholder")}
							className={`${field} placeholder:text-mute`}
						/>
					</div>
				</div>
				<div className="flex flex-col gap-3">
					<button
						type="button"
						disabled={busy || (auth.codeRequired && !token)}
						onClick={() => void create("passkey")}
						className={PRIMARY}
					>
						<PasskeyIcon />
						{t("auth.createPasskey")}
					</button>
					<button
						type="button"
						disabled={busy || (auth.codeRequired && !token)}
						onClick={() => void create("phrase")}
						className={SECONDARY}
					>
						<PhraseIcon />
						{t("auth.generatePhrase")}
					</button>
					<p className="text-xs leading-normal text-mute">
						{t("auth.passkeyNote")}
					</p>
					{error ? <Notice error>{error}</Notice> : null}
					{auth.offline ? <Notice>{t("auth.setupOffline")}</Notice> : null}
				</div>
				<KeepWriting />
			</div>
		</Page>
	);
}

/** Setup step 2: the phrase, shown once. */
export function RecoveryPage() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const [saved, setSaved] = useState(false);
	const [phrase] = useState(() => authStore.peekPhrase());
	useEffect(() => {
		document.title = t("auth.titleRecovery");
	}, [t]);

	return (
		<Page>
			<StepHeader step={t("auth.step2")} />
			<div className="flex flex-1 flex-col justify-center gap-6">
				<div className="flex flex-col gap-2.5">
					<h1 className="font-serif text-4xl leading-[1.12] font-medium tracking-[-0.015em]">
						{t("auth.keepSafe")}
					</h1>
					<p className="text-[15px] leading-relaxed text-pretty text-ink2">
						{t("auth.phraseIntro")}
					</p>
				</div>

				{phrase ? (
					<>
						<PhraseGrid phrase={phrase} />
						<PhraseActions phrase={phrase} />
						<label className="flex items-center gap-3 text-sm text-ink2">
							<input
								type="checkbox"
								checked={saved}
								onChange={(e) => setSaved(e.target.checked)}
								className="size-5 accent-ink"
							/>
							{t("auth.saved")}
						</label>
					</>
				) : (
					<p className="text-[15px] leading-relaxed text-ink2">
						{t("auth.phraseGone")}
					</p>
				)}

				<button
					type="button"
					disabled={Boolean(phrase) && !saved}
					onClick={() => {
						authStore.clearPhrase();
						void navigate({ to: "/" });
					}}
					className={PRIMARY}
				>
					{t("auth.openNotes")}
				</button>
			</div>
		</Page>
	);
}

/** Signed in, but this device does not hold the notes' key: a new device, or the idle lock. */
export function UnlockPage() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const auth = useAuth();
	const [idle] = useState(() => {
		try {
			return sessionStorage.getItem(IDLE_LOCK) === "1";
		} catch {
			return false;
		}
	});
	const [usePhrase, setUsePhrase] = useState(false);
	const [phrase, setPhrase] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		document.title = idle ? t("auth.titleLocked") : t("auth.titleUnlock");
		void authStore.refresh();
	}, [idle, t]);
	useEffect(() => {
		if (auth.phase === "signed-in") {
			try {
				sessionStorage.removeItem(IDLE_LOCK);
			} catch {
				// Nothing to clear.
			}
			void navigate({ to: "/" });
		} else if (auth.phase === "signed-out") void navigate({ to: "/sign-in" });
	}, [auth.phase, navigate]);

	const withPasskey = async () => {
		setBusy(true);
		setError(null);
		try {
			const opened = await openWithPasskey(await authenticatePasskey());
			if (!opened) {
				setUsePhrase(true);
				setError(t("auth.passkeyCannot"));
			}
			await authStore.changed();
		} catch (err) {
			setError(message(err, t("auth.passkeyRejected")));
		} finally {
			setBusy(false);
		}
	};

	const withPhrase = async (e: React.FormEvent) => {
		e.preventDefault();
		setBusy(true);
		setError(null);
		try {
			await unlockWithPhrase(phrase);
			await authStore.changed();
		} catch (err) {
			setError(message(err, t("auth.unlockFailed")));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Page>
			{idle ? null : <StepHeader step={t("auth.signedIn")} />}
			<form
				onSubmit={withPhrase}
				className={`flex flex-1 flex-col justify-center gap-6 ${idle ? "items-center text-center" : ""}`}
			>
				{idle ? <Logo size={72} /> : null}
				<div className="flex flex-col gap-2.5">
					<h1 className="font-serif text-4xl leading-[1.12] font-medium tracking-[-0.015em]">
						{idle ? t("auth.locked") : t("auth.unlockHeading")}
					</h1>
					<p className="text-[15px] leading-relaxed text-pretty text-ink2">
						{idle ? t("auth.idleText") : t("auth.unlockText")}
					</p>
				</div>
				<div className="flex w-full max-w-[320px] flex-col gap-3 self-center">
					<button
						type="button"
						disabled={busy}
						onClick={() => void withPasskey()}
						className={PRIMARY}
					>
						<PasskeyIcon />
						{t("auth.unlockPasskey")}
					</button>
					{usePhrase ? (
						<>
							<PhraseField
								id="unlock-phrase"
								value={phrase}
								onChange={setPhrase}
								autoFocus
							/>
							<button
								type="submit"
								disabled={busy || phrase.trim().length < 12}
								className={SECONDARY}
							>
								<PhraseIcon />
								{t("auth.unlockPhrase")}
							</button>
						</>
					) : (
						<button
							type="button"
							onClick={() => setUsePhrase(true)}
							className="text-[13px] text-mute underline underline-offset-[3px]"
						>
							{t("auth.usePhrase")}
						</button>
					)}
					{error ? <Notice error>{error}</Notice> : null}
					<button
						type="button"
						onClick={() => void authStore.signOut()}
						className="text-[13px] text-mute underline underline-offset-[3px]"
					>
						{t("account.signOut")}
					</button>
				</div>
			</form>
		</Page>
	);
}
/**
 * Browser half of desktop sign-in: once signed in here, hands the desktop app a short-lived
 * code through a seijaku:// link. The app trades it for its own session.
 */
export function DesktopLinkPage() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const auth = useAuth();
	const [link, setLink] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		document.title = t("auth.titleDesktop");
		void authStore.refresh();
	}, [t]);
	useEffect(() => {
		if (auth.phase === "signed-out")
			void navigate({
				to: "/sign-in",
				search: { next: "/desktop-link" } as never,
			});
		if (auth.phase !== "signed-in" && auth.phase !== "locked") return;
		void (async () => {
			try {
				const res = await fetch(apiUrl("/api/auth/seijaku/desktop-code"), {
					method: "POST",
					credentials: "include",
					headers: { "Content-Type": "application/json" },
					body: "{}",
				});
				if (!res.ok) throw new Error(t("auth.noLink"));
				const { code } = (await res.json()) as { code: string };
				const url = `seijaku://signin?code=${encodeURIComponent(code)}`;
				setLink(url);
				location.href = url;
			} catch (err) {
				setError(message(err, t("account.noServer")));
			}
		})();
	}, [auth.phase, navigate, t]);

	return (
		<Page>
			<div className="flex w-full flex-1 flex-col items-center justify-center gap-[18px] text-center">
				<Logo size={72} />
				<h1 className="font-serif text-[30px] font-medium">
					{t("auth.opening")}
				</h1>
				<p className="max-w-[360px] text-ink2">{t("auth.desktopDone")}</p>
				{link ? (
					<a href={link} className={SECONDARY}>
						{t("auth.openSeijaku")}
					</a>
				) : null}
				{error ? <Notice error>{error}</Notice> : null}
			</div>
		</Page>
	);
}
