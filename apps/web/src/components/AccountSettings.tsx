import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
	registerPasskey,
	replacePhrase,
	wrapHeldKeyForPasskey,
} from "../auth/keys";
import { authClient, authMessage, authStore, useAuth } from "../auth/session";
import { ago } from "./ago";
import { PhraseActions, PhraseGrid } from "./RecoveryPhrase";
import { Btn, Group, Row, TextField } from "./SettingRows";

/** The Settings rows that need a signed-in account: devices, passkeys, recovery codes, signing out. */

interface SessionRow {
	id: string;
	token: string;
	userAgent?: string | null;
	updatedAt: Date | string;
}

interface PasskeyRow {
	id: string;
	name?: string | null;
	createdAt?: Date | string | null;
}

/** "Windows PC · Chrome" from a user agent string. */
export function deviceLabel(ua: string | null | undefined): string {
	if (!ua) return "Unknown device";
	const os = /iPhone|iPad/.test(ua)
		? "iPhone"
		: /Android/.test(ua)
			? "Android"
			: /Mac/.test(ua)
				? "Mac"
				: /Windows/.test(ua)
					? "Windows PC"
					: /Linux/.test(ua)
						? "Linux PC"
						: "Device";
	const app = /Seijaku/.test(ua)
		? "Desktop app"
		: /Edg\//.test(ua)
			? "Edge"
			: /Firefox\//.test(ua)
				? "Firefox"
				: /Chrome\//.test(ua)
					? "Chrome"
					: /Safari\//.test(ua)
						? "Safari"
						: "Web";
	return `${os} · ${app}`;
}

/** True when this device has no account: the account rows give way to AccountRow. */
export function useSignedOut(): boolean {
	return useAuth().phase === "signed-out";
}

/** Shown in place of the account rows when signed out. */
export function AccountRow() {
	const navigate = useNavigate();
	return (
		<Row
			label="Account"
			desc="Your notes are on this device only. An account keeps them in sync, encrypted, on your other devices."
		>
			<Btn onClick={() => void navigate({ to: "/setup" })}>Create account</Btn>
			<Btn onClick={() => void navigate({ to: "/sign-in" })}>Sign in</Btn>
		</Row>
	);
}

/** Loads something from the server, with a way to load it again and a quiet failure. */
function useLoad<T>(load: () => Promise<T>) {
	const [data, setData] = useState<T | null>(null);
	const [failed, setFailed] = useState(false);
	const reload = useCallback(async () => {
		try {
			setData(await load());
			setFailed(false);
		} catch {
			setFailed(true);
		}
	}, [load]);
	useEffect(() => {
		void reload();
	}, [reload]);
	return { data, failed, reload };
}

const loadSessions = async () => {
	const client = authClient();
	const [list, current] = await Promise.all([
		client.listSessions(),
		client.getSession(),
	]);
	if (list.error) throw new Error(list.error.message);
	return {
		sessions: (list.data ?? []) as SessionRow[],
		currentId: current.data?.session.id ?? null,
	};
};

const loadPasskeys = async () => {
	const res = await authClient().passkey.listUserPasskeys();
	if (res.error) throw new Error(res.error.message);
	return (res.data ?? []) as PasskeyRow[];
};

function Problem({ children }: { children: string }) {
	return (
		<p role="alert" className="pt-2 text-[13px] text-accent">
			{children}
		</p>
	);
}

/** Every device that is signed in, each with a Sign out. */
export function DevicesGroup() {
	const { data, failed, reload } = useLoad(loadSessions);
	const auth = useAuth();
	const [now] = useState(() => Date.now());
	const [error, setError] = useState<string | null>(null);

	const end = async (token: string) => {
		setError(null);
		const res = await authClient().revokeSession({ token });
		if (res.error) setError(authMessage(res.error, "Could not sign out."));
		await reload();
	};

	return (
		<Group name="Signed-in devices">
			{data?.sessions.map((s) => {
				const here = s.id === data.currentId;
				return (
					<Row
						key={s.id}
						label={deviceLabel(s.userAgent)}
						desc={
							here
								? "Active now"
								: `Last active ${ago(new Date(s.updatedAt).getTime(), now)}`
						}
						note={here ? "This device" : undefined}
					>
						<Btn
							onClick={() => void (here ? authStore.signOut() : end(s.token))}
						>
							Sign out
						</Btn>
					</Row>
				);
			})}
			{!data && !failed ? (
				<Row label="Devices" desc="Loading…">
					<span />
				</Row>
			) : null}
			{failed ? (
				<Row
					label="Devices"
					desc={
						auth.offline
							? "Connect to your server to see which devices are signed in."
							: "Could not load the list of devices."
					}
				>
					<Btn onClick={() => void reload()}>Try again</Btn>
				</Row>
			) : null}
			{error ? <Problem>{error}</Problem> : null}
		</Group>
	);
}

/** Passkeys on the account: list, add, remove. */
export function PasskeysGroup({ deviceName }: { deviceName: string }) {
	const { data, failed, reload } = useLoad(loadPasskeys);
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const add = async () => {
		setBusy(true);
		setError(null);
		try {
			await wrapHeldKeyForPasskey(
				await registerPasskey({ name: name.trim() || `${deviceName} passkey` }),
			);
			setName("");
			await reload();
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Could not reach the server.",
			);
		} finally {
			setBusy(false);
		}
	};

	const remove = async (id: string) => {
		setError(null);
		const res = await authClient().passkey.deletePasskey({ id });
		if (res.error)
			setError(authMessage(res.error, "The passkey could not be removed."));
		await reload();
	};

	const only = data?.length === 1;
	return (
		<Group name="Passkeys">
			{data?.map((k) => (
				<Row
					key={k.id}
					label={k.name || "Passkey"}
					desc={
						only
							? "Your only passkey. Add another before removing this one."
							: k.createdAt
								? `Added ${new Date(k.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}`
								: undefined
					}
				>
					<Btn danger disabled={only} onClick={() => void remove(k.id)}>
						Remove
					</Btn>
				</Row>
			))}
			{failed ? (
				<Row label="Passkeys" desc="Could not load your passkeys.">
					<Btn onClick={() => void reload()}>Try again</Btn>
				</Row>
			) : null}
			<Row
				label="Add a passkey"
				desc="Make one on this device, on a phone, or on a security key."
			>
				<TextField
					label="Passkey name"
					value={name}
					onChange={setName}
					placeholder={`${deviceName} passkey`}
					width="w-44"
				/>
				<Btn disabled={busy} onClick={() => void add()}>
					Add passkey
				</Btn>
			</Row>
			{error ? <Problem>{error}</Problem> : null}
		</Group>
	);
}

/** Replace the recovery phrase: the old one stops working, notes stay as they are. */
export function RecoveryGroup() {
	const [confirming, setConfirming] = useState(false);
	const [phrase, setPhrase] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const replace = async () => {
		setError(null);
		try {
			setPhrase(await replacePhrase());
			setConfirming(false);
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Could not make a new phrase.",
			);
		}
	};

	return (
		<>
			<Row
				label="Recovery phrase"
				desc="Twelve words that restore your notes on a new device. Keep them somewhere offline."
			>
				{confirming ? (
					<>
						<span className="text-[13px] text-mute">
							This ends your old phrase.
						</span>
						<Btn danger onClick={() => void replace()}>
							Replace phrase
						</Btn>
						<Btn onClick={() => setConfirming(false)}>Cancel</Btn>
					</>
				) : (
					<Btn onClick={() => setConfirming(true)}>Make a new phrase</Btn>
				)}
			</Row>
			{phrase ? (
				<div className="flex flex-col gap-3.5 border-b border-line2 py-4">
					<p className="text-[13px] text-mute">
						This is your new phrase. It is shown only now.
					</p>
					<PhraseGrid phrase={phrase} />
					<PhraseActions phrase={phrase} />
				</div>
			) : null}
			{error ? <Problem>{error}</Problem> : null}
		</>
	);
}

/** Sign out on every device, this one included. */
export function SignOutEverywhere() {
	const [error, setError] = useState<string | null>(null);
	return (
		<>
			<Row
				label="Sign out everywhere"
				desc="Ends every session, including this one."
			>
				<Btn
					danger
					onClick={() =>
						void (async () => {
							const res = await authClient().revokeSessions();
							if (res.error)
								setError(authMessage(res.error, "Could not sign out."));
							else await authStore.signOut();
						})()
					}
				>
					Sign out all
				</Btn>
			</Row>
			{error ? <Problem>{error}</Problem> : null}
		</>
	);
}
