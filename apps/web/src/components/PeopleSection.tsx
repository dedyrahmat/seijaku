import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/session";
import { collab, type Invite, type Person } from "../workspace/collab";
import { useCollab } from "../workspace/hooks";
import { askConfirm } from "./Dialogs";
import { Select } from "./SettingRows";

const ROLES = ["editor", "reader"] as const;
type Pick = (typeof ROLES)[number];

/** The Share panel's "Share with people" part: who has this page, invites, and removing people. */
export function PeopleSection({ noteId }: { noteId: string }) {
	const { t } = useTranslation();
	const auth = useAuth();
	const entry = useCollab().find(([, e]) => e.noteId === noteId && !e.ended);
	const shareId = entry?.[0];
	const rotating = Boolean(entry?.[1].rotating);
	const [people, setPeople] = useState<Person[]>([]);
	const [invites, setInvites] = useState<Invite[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [dialog, setDialog] = useState(false);

	const load = useCallback(async () => {
		if (!shareId) return;
		try {
			const r = await collab.people(shareId);
			setPeople(r.people.filter((p) => !p.you));
			setInvites(r.invites);
		} catch {
			setError(t("collab.loadFailed"));
		}
	}, [shareId, t]);
	useEffect(() => {
		void load();
	}, [load]);

	const act = async (job: () => Promise<unknown>) => {
		setError(null);
		try {
			await job();
		} catch {
			setError(t("errors.noServerMoment"));
		}
		await load();
	};

	const initial = (label: string) => (label.trim()[0] ?? "?").toUpperCase();
	const label = (p: { label: string }) => p.label || t("collab.someone");
	const roleLabels = {
		editor: t("collab.role.editor"),
		reader: t("collab.role.reader"),
	};

	return (
		<div className="flex flex-col gap-2 border-t border-line2 pt-3.5">
			<span className="text-[11px] font-semibold tracking-[0.08em] text-mute uppercase">
				{t("collab.title")}
			</span>
			{auth.phase !== "signed-in" ? (
				<p className="text-[13px] leading-normal text-mute">
					{t("collab.needsAccount")}
				</p>
			) : (
				<>
					{people.map((p) => (
						<div key={p.memberId} className="flex items-center gap-3">
							<span className="flex size-[30px] flex-none items-center justify-center rounded-full bg-hover font-serif text-[13px]">
								{initial(label(p))}
							</span>
							<span className="min-w-0 flex-1">
								<span className="block truncate text-[13.5px]">{label(p)}</span>
							</span>
							<Select
								label={t("collab.roleFor", { name: label(p) })}
								value={p.role === "reader" ? "reader" : "editor"}
								options={ROLES}
								labels={roleLabels}
								onChange={(role: Pick) =>
									shareId &&
									act(() => collab.setRole(shareId, p.memberId, role))
								}
								disabled={rotating}
							/>
							<button
								type="button"
								aria-label={t("collab.remove", { name: label(p) })}
								disabled={rotating}
								onClick={async () => {
									if (
										shareId &&
										(await askConfirm(
											`${t("collab.removeConfirm", { name: label(p) })}\n\n${t("collab.removeLimit", { name: label(p) })}`,
											{
												confirm: t("collab.remove", { name: label(p) }),
												danger: true,
											},
										))
									)
										void act(() => collab.remove(shareId, p.memberId));
								}}
								className="flex size-8 flex-none items-center justify-center rounded-full text-mute hover:bg-hover disabled:opacity-40"
							>
								×
							</button>
						</div>
					))}
					{invites.map((i) => (
						<div key={i.id} className="flex items-center gap-3">
							<span className="flex size-[30px] flex-none items-center justify-center rounded-full bg-hover text-[13px]">
								…
							</span>
							<span className="min-w-0 flex-1">
								<span className="block truncate text-[13.5px]">{label(i)}</span>
								<span className="text-xs text-mute">
									{t("collab.waiting", {
										when: new Date(i.expiresAt).toLocaleDateString(undefined, {
											day: "numeric",
											month: "short",
										}),
									})}
								</span>
							</span>
							<button
								type="button"
								onClick={() =>
									shareId && act(() => collab.cancelInvite(shareId, i.id))
								}
								className="h-8 rounded-full border border-line px-3 text-[13px] hover:bg-hover"
							>
								{t("common.cancel")}
							</button>
						</div>
					))}
					{people.length === 0 && invites.length === 0 ? (
						<p className="text-[13px] leading-normal text-mute">
							{t("collab.nobody")}
						</p>
					) : null}
					{rotating ? (
						<p role="status" className="text-[13px] text-mute">
							{t("collab.finishingNote")}
						</p>
					) : null}
					{error ? (
						<p role="alert" className="text-[13px] text-accent">
							{error}
						</p>
					) : null}
					<div className="flex items-center gap-3">
						<button
							type="button"
							onClick={() => setDialog(true)}
							className="h-9 rounded-full bg-ink px-4 text-[13px] font-medium text-paper"
						>
							{t("collab.invite")}
						</button>
						{shareId ? (
							<button
								type="button"
								onClick={async () => {
									if (
										await askConfirm(t("collab.stopConfirm"), {
											confirm: t("collab.stop"),
											danger: true,
										})
									)
										void act(() => collab.stop(shareId));
								}}
								className="ml-auto text-[13px] text-accent"
							>
								{t("collab.stop")}
							</button>
						) : null}
					</div>
					<p className="text-xs leading-normal text-mute">{t("collab.note")}</p>
					{dialog ? (
						<InviteDialog
							noteId={noteId}
							onClose={() => {
								setDialog(false);
								void load();
							}}
						/>
					) : null}
				</>
			)}
		</div>
	);
}

/** Make an invite link: a name for your list, a role, then the link itself. */
function InviteDialog({
	noteId,
	onClose,
}: {
	noteId: string;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const [name, setName] = useState("");
	const [role, setRole] = useState<Pick>("editor");
	const [link, setLink] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		document.addEventListener("keydown", esc);
		return () => document.removeEventListener("keydown", esc);
	}, [onClose]);

	const make = async () => {
		setBusy(true);
		setError(null);
		try {
			const id = await collab.share(noteId);
			setLink(await collab.invite(id, role, name.trim()));
		} catch {
			setError(t("errors.noServerMoment"));
		} finally {
			setBusy(false);
		}
	};

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: the scrim only closes on a click; Esc closes from the keyboard
		<div
			className="fixed inset-0 z-[60] flex items-center justify-center bg-scrim p-4"
			onMouseDown={(e) => e.target === e.currentTarget && onClose()}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={t("collab.inviteTitle")}
				className="w-full max-w-[520px] rounded-2xl border border-line bg-paper p-6 text-ink shadow-[0_30px_80px_rgba(40,30,15,0.28)]"
			>
				{link ? (
					<>
						<h2 className="font-serif text-[22px] font-medium">
							{t("collab.linkReady")}
						</h2>
						<p className="mt-1 mb-4 text-[13px] text-ink2">
							{t("collab.linkReadyDesc")}
						</p>
						<input
							readOnly
							value={link}
							aria-label={t("collab.inviteLink")}
							onFocus={(e) => e.currentTarget.select()}
							className="h-[38px] w-full rounded-full border border-line bg-paper px-3.5 font-mono text-[12.5px]"
						/>
						<div className="mt-4 flex gap-2">
							<button
								type="button"
								onClick={() =>
									void navigator.clipboard?.writeText(link).then(() => {
										setCopied(true);
										setTimeout(() => setCopied(false), 1800);
									})
								}
								className="h-9 rounded-full bg-ink px-4 text-[13px] font-medium text-paper"
							>
								{copied ? t("common.copied") : t("common.copyLink")}
							</button>
							<button
								type="button"
								onClick={onClose}
								className="h-9 rounded-full border border-line px-4 text-[13px]"
							>
								{t("common.done")}
							</button>
						</div>
						<p className="mt-3 rounded-[10px] bg-panel px-3 py-2.5 text-[13px] text-ink2">
							{t("collab.linkKeyNote")}
						</p>
					</>
				) : (
					<>
						<h2 className="font-serif text-[22px] font-medium">
							{t("collab.inviteTitle")}
						</h2>
						<p className="mt-1 mb-4 text-[13px] text-ink2">
							{t("collab.inviteDesc")}
						</p>
						<label className="flex flex-col gap-1.5 text-[13px]">
							<span>{t("collab.nameForList")}</span>
							<input
								value={name}
								onChange={(e) => setName(e.target.value)}
								maxLength={60}
								// biome-ignore lint/a11y/noAutofocus: the dialog was opened to type into
								autoFocus
								className="h-[38px] rounded-full border border-line bg-paper px-3.5 text-[14px]"
							/>
							<span className="text-xs text-mute">
								{t("collab.nameOnlyYou")}
							</span>
						</label>
						<div className="mt-4 flex items-center gap-3 text-[13px]">
							<span className="flex-1">{t("collab.theyCan")}</span>
							<Select
								label={t("collab.theyCan")}
								value={role}
								options={ROLES}
								labels={{
									editor: t("collab.canEdit"),
									reader: t("collab.canRead"),
								}}
								onChange={setRole}
							/>
						</div>
						{error ? (
							<p role="alert" className="mt-3 text-[13px] text-accent">
								{error}
							</p>
						) : null}
						<div className="mt-5 flex justify-end gap-2">
							<button
								type="button"
								onClick={onClose}
								className="h-9 rounded-full border border-line px-4 text-[13px]"
							>
								{t("common.cancel")}
							</button>
							<button
								type="button"
								disabled={busy}
								onClick={make}
								className="h-9 rounded-full bg-ink px-4 text-[13px] font-medium text-paper disabled:opacity-50"
							>
								{t("collab.makeLink")}
							</button>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
