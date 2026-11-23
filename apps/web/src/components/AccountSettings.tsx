import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	NeedsPhrase,
	registerPasskey,
	replacePhrase,
	wrapHeldKeyForPasskey,
} from "../auth/keys";
import { authClient, authMessage, authStore, useAuth } from "../auth/session";
import { i18n } from "../i18n";
import { ago } from "./ago";
import { askText } from "./Dialogs";
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
	if (!ua) return i18n.t("device.unknown");
	const os = /iPhone|iPad/.test(ua)
		? "iPhone"
		: /Android/.test(ua)
			? "Android"
			: /Mac/.test(ua)
				? "Mac"
				: /Windows/.test(ua)
					? i18n.t("settings.device.windows")
					: /Linux/.test(ua)
						? i18n.t("settings.device.linux")
						: i18n.t("device.generic");
	const app = /Seijaku/.test(ua)
		? i18n.t("common.desktopApp")
		: /Edg\//.test(ua)
			? "Edge"
			: /Firefox\//.test(ua)
				? "Firefox"
				: /Chrome\//.test(ua)
					? "Chrome"
					: /Safari\//.test(ua)
						? "Safari"
						: i18n.t("settings.about.where.web");
	return `${os} · ${app}`;
}

/** True when this device has no account: the account rows give way to AccountRow. */
export function useSignedOut(): boolean {
	return useAuth().phase === "signed-out";
}

/** Shown in place of the account rows when signed out. */
export function AccountRow() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	return (
		<Row label={t("settings.account")} desc={t("account.signedOutDesc")}>
			<Btn onClick={() => void navigate({ to: "/setup" })}>
				{t("account.create")}
			</Btn>
			<Btn onClick={() => void navigate({ to: "/sign-in" })}>
				{t("account.signIn")}
			</Btn>
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
	const { t } = useTranslation();
	const { data, failed, reload } = useLoad(loadSessions);
	const auth = useAuth();
	const [now] = useState(() => Date.now());
	const [error, setError] = useState<string | null>(null);

	const end = async (token: string) => {
		setError(null);
		const res = await authClient().revokeSession({ token });
		if (res.error) setError(authMessage(res.error, t("account.signOutFailed")));
		await reload();
	};

	return (
		<Group name={t("account.devicesTitle")}>
			{data?.sessions.map((s) => {
				const here = s.id === data.currentId;
				return (
					<Row
						key={s.id}
						label={deviceLabel(s.userAgent)}
						desc={
							here
								? t("account.activeNow")
								: t("account.lastActive", {
										when: ago(new Date(s.updatedAt).getTime(), now),
									})
						}
						note={here ? t("settings.device.other") : undefined}
					>
						<Btn
							onClick={() => void (here ? authStore.signOut() : end(s.token))}
						>
							{t("account.signOut")}
						</Btn>
					</Row>
				);
			})}
			{!data && !failed ? (
				<Row label={t("account.devices")} desc={t("common.loading")}>
					<span />
				</Row>
			) : null}
			{failed ? (
				<Row
					label={t("account.devices")}
					desc={
						auth.offline
							? t("account.devicesOffline")
							: t("account.devicesFailed")
					}
				>
					<Btn onClick={() => void reload()}>{t("settings.data.tryAgain")}</Btn>
				</Row>
			) : null}
			{error ? <Problem>{error}</Problem> : null}
		</Group>
	);
}

/** Passkeys on the account: list, add, remove. */
export function PasskeysGroup({ deviceName }: { deviceName: string }) {
	const { t } = useTranslation();
	const { data, failed, reload } = useLoad(loadPasskeys);
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const add = async () => {
		setBusy(true);
		setError(null);
		try {
			await wrapHeldKeyForPasskey(
				await registerPasskey({
					name:
						name.trim() || t("account.passkeyDefault", { device: deviceName }),
				}),
			);
			setName("");
			await reload();
		} catch (err) {
			setError(err instanceof Error ? err.message : t("account.noServer"));
		} finally {
			setBusy(false);
		}
	};

	const remove = async (id: string) => {
		setError(null);
		const res = await authClient().passkey.deletePasskey({ id });
		if (res.error) setError(authMessage(res.error, t("account.removeFailed")));
		await reload();
	};

	const only = data?.length === 1;
	return (
		<Group name={t("account.passkeys")}>
			{data?.map((k) => (
				<Row
					key={k.id}
					label={k.name || t("account.passkey")}
					desc={
						only
							? t("account.onlyPasskey")
							: k.createdAt
								? t("account.added", {
										date: new Date(k.createdAt).toLocaleDateString(undefined, {
											day: "numeric",
											month: "long",
											year: "numeric",
										}),
									})
								: undefined
					}
				>
					<Btn danger disabled={only} onClick={() => void remove(k.id)}>
						{t("common.remove")}
					</Btn>
				</Row>
			))}
			{failed ? (
				<Row label={t("account.passkeys")} desc={t("account.passkeysFailed")}>
					<Btn onClick={() => void reload()}>{t("settings.data.tryAgain")}</Btn>
				</Row>
			) : null}
			<Row label={t("account.addPasskey")} desc={t("account.addPasskeyDesc")}>
				<TextField
					label={t("account.passkeyName")}
					value={name}
					onChange={setName}
					placeholder={t("account.passkeyDefault", { device: deviceName })}
					width="w-44"
				/>
				<Btn disabled={busy} onClick={() => void add()}>
					{t("account.addPasskeyButton")}
				</Btn>
			</Row>
			{error ? <Problem>{error}</Problem> : null}
		</Group>
	);
}

/** Replace the recovery phrase: the old one stops working, notes stay as they are. */
export function RecoveryGroup() {
	const { t } = useTranslation();
	const [confirming, setConfirming] = useState(false);
	const [phrase, setPhrase] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const replace = async () => {
		setError(null);
		try {
			let made: string;
			try {
				made = await replacePhrase();
			} catch (err) {
				if (!(err instanceof NeedsPhrase)) throw err;
				const typed = await askText(t("account.currentPhrasePrompt"));
				if (!typed) return;
				made = await replacePhrase(typed);
			}
			setPhrase(made);
			setConfirming(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : t("account.phraseFailed"));
		}
	};

	return (
		<>
			<Row label={t("account.phrase")} desc={t("account.phraseDesc")}>
				{confirming ? (
					<>
						<span className="text-[13px] text-mute">
							{t("account.phraseEnds")}
						</span>
						<Btn danger onClick={() => void replace()}>
							{t("account.replacePhrase")}
						</Btn>
						<Btn onClick={() => setConfirming(false)}>{t("common.cancel")}</Btn>
					</>
				) : (
					<Btn onClick={() => setConfirming(true)}>
						{t("account.newPhrase")}
					</Btn>
				)}
			</Row>
			{phrase ? (
				<div className="flex flex-col gap-3.5 border-b border-line2 py-4">
					<p className="text-[13px] text-mute">{t("account.phraseNew")}</p>
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
	const { t } = useTranslation();
	const [error, setError] = useState<string | null>(null);
	return (
		<>
			<Row label={t("account.signOutAll")} desc={t("account.signOutAllDesc")}>
				<Btn
					danger
					onClick={() =>
						void (async () => {
							const res = await authClient().revokeSessions();
							if (res.error)
								setError(authMessage(res.error, t("account.signOutFailed")));
							else await authStore.signOut();
						})()
					}
				>
					{t("account.signOutAllButton")}
				</Btn>
			</Row>
			{error ? <Problem>{error}</Problem> : null}
		</>
	);
}
