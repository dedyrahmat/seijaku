import { Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
	createPhraseForNewWorkspace,
	signInWithPhrase,
	signUpWithPhrase,
	unlockWithPhrase,
} from "../auth/keys";
import { authClient, authMessage, authStore, useAuth } from "../auth/session";
import { Logo } from "../components/Logo";
import {
	PhraseActions,
	PhraseField,
	PhraseGrid,
} from "../components/RecoveryPhrase";
import { savedServerUrl } from "../workspace/syncUrl";

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
	return (
		<Link
			to="/"
			className="text-center text-[13px] text-mute underline underline-offset-[3px]"
		>
			Keep writing without an account
		</Link>
	);
}

export function SignInPage() {
	const navigate = useNavigate();
	const auth = useAuth();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [usePhrase, setUsePhrase] = useState(false);
	const [phrase, setPhrase] = useState("");

	useEffect(() => {
		document.title = "Sign in · Seijaku";
		void authStore.refresh();
	}, []);
	useEffect(() => {
		if (auth.phase === "signed-in") void navigate({ to: "/" });
		else if (auth.phase === "locked") void navigate({ to: "/unlock" });
	}, [auth.phase, navigate]);
	const server = savedServerUrl().replace(/^https?:\/\//, "") || location.host;

	const withPasskey = async () => {
		setBusy(true);
		setError(null);
		try {
			const res = await authClient().signIn.passkey();
			if (res?.error) {
				setError(authMessage(res.error, "That passkey was not accepted."));
				return;
			}
			await authStore.changed();
		} catch {
			setError("Could not reach the server. Check the address below.");
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
			setError(message(err, "Could not sign in with that phrase."));
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
				<p className="font-serif text-lg text-ink2 italic">
					Active calm. The opposite of noise.
				</p>

				<div className="mt-[18px] flex w-full flex-col gap-3.5 text-left">
					<button
						type="button"
						disabled={busy}
						onClick={() => void withPasskey()}
						className={PRIMARY}
					>
						<PasskeyIcon />
						Sign in with passkey
					</button>
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
								Sign in with phrase
							</button>
						</form>
					) : (
						<button
							type="button"
							onClick={() => setUsePhrase(true)}
							className={SECONDARY}
						>
							<PhraseIcon />
							Sign in with phrase
						</button>
					)}
					{error ? <Notice error>{error}</Notice> : null}
					{auth.offline ? (
						<div className="flex flex-col items-center gap-2">
							<Notice>
								This device cannot reach the server right now, so it cannot sign
								in.
							</Notice>
							<button
								type="button"
								onClick={() => void authStore.refresh()}
								className="text-[13px] text-ink underline underline-offset-[3px]"
							>
								Try again
							</button>
						</div>
					) : null}
					<Link
						to="/setup"
						className="text-center text-[13px] text-mute underline underline-offset-[3px]"
					>
						New here? Create an account
					</Link>
					<KeepWriting />
				</div>
			</div>

			<div className="flex w-full items-center justify-center gap-2 border-t border-line2 pt-[18px] text-[13px] text-mute">
				<span>Server</span>
				<span className="font-mono text-xs text-ink2">{server}</span>
				<Link
					to="/settings/$section"
					params={{ section: "sync" }}
					className="text-ink2 underline underline-offset-[3px]"
				>
					Change
				</Link>
			</div>
		</Page>
	);
}

export function SetupPage() {
	const navigate = useNavigate();
	const auth = useAuth();
	const [token, setToken] = useState("");
	const [device, setDevice] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const working = useRef(false);

	useEffect(() => {
		document.title = "Create account · Seijaku";
		void authStore.refresh();
	}, []);
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
				const res = await authClient().passkey.addPasskey({
					name: device.trim() || "This device",
					context: auth.codeRequired ? token : "",
					createSession: true,
				});
				if (res?.error) {
					setError(authMessage(res.error, "The passkey could not be made."));
					working.current = false;
					return;
				}
				authStore.holdPhrase(await createPhraseForNewWorkspace());
			} else {
				authStore.holdPhrase(
					await signUpWithPhrase(auth.codeRequired ? token : ""),
				);
			}
			await authStore.changed();
			void navigate({ to: "/recovery-phrase" });
		} catch (err) {
			setError(
				message(
					err,
					"Could not reach the server. Check the address and try again.",
				),
			);
			working.current = false;
		} finally {
			setBusy(false);
		}
	};

	const field =
		"h-[46px] rounded-2xl border border-line bg-raised px-3.5 text-[15px] text-ink outline-none focus:border-mute";

	return (
		<Page>
			<StepHeader step="Step 1 of 2" />
			<div className="flex flex-1 flex-col justify-center gap-7">
				<div className="flex flex-col gap-2.5">
					<h1 className="font-serif text-4xl leading-[1.12] font-medium tracking-[-0.015em]">
						Create your account
					</h1>
					<p className="text-[15px] leading-relaxed text-pretty text-ink2">
						Choose how you will sign in. Your notes are encrypted on your
						devices, and you get a twelve-word phrase to keep either way.
						Everything you have written so far comes with you.
					</p>
				</div>
				<div className="flex flex-col gap-[18px]">
					{auth.codeRequired ? (
						<div className="flex flex-col gap-1.5">
							<label htmlFor="setup-token" className="text-[13px] font-medium">
								Sign-up code
							</label>
							<input
								id="setup-token"
								type="password"
								autoComplete="off"
								value={token}
								onChange={(e) => setToken(e.target.value)}
								className={field}
							/>
							<span className="text-xs text-mute">
								This server asks for a code. Whoever runs it can give you one.
							</span>
						</div>
					) : null}
					<div className="flex flex-col gap-1.5">
						<label htmlFor="setup-device" className="text-[13px] font-medium">
							Name this device
						</label>
						<input
							id="setup-device"
							type="text"
							value={device}
							onChange={(e) => setDevice(e.target.value)}
							placeholder="Studio laptop"
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
						Create passkey
					</button>
					<button
						type="button"
						disabled={busy || (auth.codeRequired && !token)}
						onClick={() => void create("phrase")}
						className={SECONDARY}
					>
						<PhraseIcon />
						Generate a phrase instead
					</button>
					<p className="text-xs leading-normal text-mute">
						A passkey signs you in with your fingerprint, face or device lock. A
						phrase alone is like a crypto wallet: just the words, nothing to
						remember.
					</p>
					{error ? <Notice error>{error}</Notice> : null}
					{auth.offline ? (
						<Notice>
							This device cannot reach the server right now. Check that it is
							running, then try again.
						</Notice>
					) : null}
				</div>
				<KeepWriting />
			</div>
		</Page>
	);
}

/** Setup step 2: the phrase, shown once. */
export function RecoveryPage() {
	const navigate = useNavigate();
	const [saved, setSaved] = useState(false);
	const [phrase] = useState(() => authStore.peekPhrase());
	useEffect(() => {
		document.title = "Recovery phrase · Seijaku";
	}, []);

	return (
		<Page>
			<StepHeader step="Step 2 of 2" />
			<div className="flex flex-1 flex-col justify-center gap-6">
				<div className="flex flex-col gap-2.5">
					<h1 className="font-serif text-4xl leading-[1.12] font-medium tracking-[-0.015em]">
						Keep this phrase safe
					</h1>
					<p className="text-[15px] leading-relaxed text-pretty text-ink2">
						These twelve words are the key to your notes. If you lose every
						signed-in device and this phrase, your notes cannot be recovered,
						not even by us. Anyone who has it can read them. It is shown only
						now.
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
							I saved these words somewhere safe
						</label>
					</>
				) : (
					<p className="text-[15px] leading-relaxed text-ink2">
						The phrase is shown once, and this page no longer has it. Make a new
						one any time in Settings, under Security.
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
					Open my notes
				</button>
			</div>
		</Page>
	);
}

/** Signed in, but this device does not hold the notes' key yet. */
export function UnlockPage() {
	const navigate = useNavigate();
	const auth = useAuth();
	const [phrase, setPhrase] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		document.title = "Unlock · Seijaku";
		void authStore.refresh();
	}, []);
	useEffect(() => {
		if (auth.phase === "signed-in") void navigate({ to: "/" });
		else if (auth.phase === "signed-out") void navigate({ to: "/sign-in" });
	}, [auth.phase, navigate]);

	const unlock = async (e: React.FormEvent) => {
		e.preventDefault();
		setBusy(true);
		setError(null);
		try {
			await unlockWithPhrase(phrase);
			await authStore.changed();
		} catch (err) {
			setError(message(err, "Could not unlock with that phrase."));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Page>
			<StepHeader step="Signed in" />
			<form
				onSubmit={unlock}
				className="flex flex-1 flex-col justify-center gap-6"
			>
				<div className="flex flex-col gap-2.5">
					<h1 className="font-serif text-4xl leading-[1.12] font-medium tracking-[-0.015em]">
						Unlock your notes
					</h1>
					<p className="text-[15px] leading-relaxed text-pretty text-ink2">
						Your notes are encrypted, and this device does not have their key
						yet. Enter your twelve-word recovery phrase to open them here.
					</p>
				</div>
				<PhraseField
					id="unlock-phrase"
					value={phrase}
					onChange={setPhrase}
					autoFocus
				/>
				<div className="flex flex-col gap-3">
					<button
						type="submit"
						disabled={busy || phrase.trim().length < 12}
						className={PRIMARY}
					>
						<PhraseIcon />
						Unlock
					</button>
					{error ? <Notice error>{error}</Notice> : null}
					<button
						type="button"
						onClick={() => void authStore.signOut()}
						className="text-[13px] text-mute underline underline-offset-[3px]"
					>
						Sign out
					</button>
				</div>
			</form>
		</Page>
	);
}
