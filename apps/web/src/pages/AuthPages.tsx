import { Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { Logo } from "../components/Logo";
import { savedServerUrl } from "../workspace/syncUrl";

/**
 * The mockup's Sign-In, Setup and Recovery boards. Accounts and passkeys arrive in phase 4; until
 * then the server is open, so these screens say so instead of pretending to sign anyone in.
 */

const PRIMARY =
	"flex h-[50px] w-full items-center justify-center gap-2.5 rounded-2xl bg-ink text-[15px] font-medium text-paper hover:opacity-90 disabled:opacity-40";

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

function Notice({ children }: { children: ReactNode }) {
	return (
		<p
			role="status"
			className="text-center text-[13px] leading-normal text-mute"
		>
			{children}
		</p>
	);
}

export function SignInPage() {
	const [asked, setAsked] = useState(false);
	useEffect(() => {
		document.title = "Sign in · Seijaku";
	}, []);
	const server = savedServerUrl().replace(/^https?:\/\//, "") || location.host;

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

				<div className="mt-[18px] flex w-full flex-col gap-3.5">
					<button
						type="button"
						onClick={() => setAsked(true)}
						className={PRIMARY}
					>
						<PasskeyIcon />
						Sign in with passkey
					</button>
					<span className="text-sm text-ink2 underline underline-offset-[3px]">
						Lost your passkey? Use a recovery code
					</span>
					{asked ? (
						<Notice>
							Sign-in is not switched on for this server yet. Your notes open
							without it.{" "}
							<Link to="/" className="text-ink underline">
								Open my notes
							</Link>
						</Notice>
					) : null}
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
	const [token, setToken] = useState("");
	const [device, setDevice] = useState("");
	const [asked, setAsked] = useState(false);
	useEffect(() => {
		document.title = "Set up · Seijaku";
	}, []);

	const field =
		"h-[46px] rounded-2xl border border-line bg-raised px-3.5 text-[15px] text-ink outline-none focus:border-mute";

	return (
		<Page>
			<StepHeader step="Step 1 of 2" />
			<div className="flex flex-1 flex-col justify-center gap-7">
				<div className="flex flex-col gap-2.5">
					<h1 className="font-serif text-4xl leading-[1.12] font-medium tracking-[-0.015em]">
						Claim this server
					</h1>
					<p className="text-[15px] leading-relaxed text-pretty text-ink2">
						This Seijaku is new. Enter the setup token from your server
						settings, then make a passkey for yourself. After this, sign-ups
						close.
					</p>
				</div>
				<div className="flex flex-col gap-[18px]">
					<div className="flex flex-col gap-1.5">
						<label htmlFor="setup-token" className="text-[13px] font-medium">
							Setup token
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
							It is the SETUP_TOKEN value you set when you started the server.
						</span>
					</div>
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
						onClick={() => setAsked(true)}
						className={PRIMARY}
					>
						<PasskeyIcon />
						Create passkey
					</button>
					{asked ? (
						<Notice>
							Passkeys are not switched on for this server yet, so there is
							nothing to claim.{" "}
							<Link to="/" className="text-ink underline">
								Open my notes
							</Link>
						</Notice>
					) : null}
				</div>
			</div>
		</Page>
	);
}

export function RecoveryPage() {
	const navigate = useNavigate();
	const [saved, setSaved] = useState(false);
	useEffect(() => {
		document.title = "Recovery codes · Seijaku";
	}, []);

	const ghost =
		"h-10 rounded-[14px] border border-line px-[18px] text-sm text-ink hover:bg-hover disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent";

	return (
		<Page>
			<StepHeader step="Step 2 of 2" />
			<div className="flex flex-1 flex-col justify-center gap-6">
				<div className="flex flex-col gap-2.5">
					<h1 className="font-serif text-4xl leading-[1.12] font-medium tracking-[-0.015em]">
						Keep these codes safe
					</h1>
					<p className="text-[15px] leading-relaxed text-pretty text-ink2">
						If you lose every passkey, one of these gets you back in. Each works
						once. They are shown only now.
					</p>
				</div>

				<div
					role="img"
					aria-label="Eight recovery codes, made when you create your passkey"
					className="grid grid-cols-2 gap-x-3 gap-y-2.5 rounded-[20px] border border-line bg-raised p-5 font-mono text-[15px] tracking-[0.06em] text-mute"
				>
					{Array.from({ length: 8 }, (_, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: eight identical placeholders
						<span key={i}>••••-••••</span>
					))}
				</div>
				<p className="-mt-3 text-[13px] text-mute">
					Codes are made when you create your passkey. Sign-in is not switched
					on yet.
				</p>

				<div className="flex gap-2.5">
					<button type="button" disabled className={ghost}>
						Copy all
					</button>
					<button type="button" disabled className={ghost}>
						Download .txt
					</button>
				</div>

				<label className="flex items-center gap-3 text-sm text-ink2">
					<input
						type="checkbox"
						checked={saved}
						onChange={(e) => setSaved(e.target.checked)}
						className="size-5 accent-ink"
					/>
					I saved these somewhere safe
				</label>

				<button
					type="button"
					disabled={!saved}
					onClick={() => void navigate({ to: "/" })}
					className={PRIMARY}
				>
					Open my notes
				</button>
			</div>
		</Page>
	);
}
