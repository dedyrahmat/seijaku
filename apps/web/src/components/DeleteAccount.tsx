import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DeleteError, deleteAccount } from "../auth/deleteAccount";
import { CLEAR_FLAG } from "../clearPending";
import { exportWorkspace } from "../export";
import { Modal } from "./DeviceSettings";
import { Btn, Row } from "./SettingRows";

/**
 * Settings → Security → Delete account (phase 17 boards): what goes, then proof (passkey or the
 * phrase) plus typing the word, then the work, then the choice to wipe this device too.
 */

type Step =
	| { step: "idle" }
	| { step: "warn" }
	| { step: "confirm"; problem?: { title: string; desc: string } }
	| { step: "working" }
	| { step: "failed"; title: string; desc: string }
	| { step: "done" };

const button =
	"h-9 rounded-full px-4 text-[13px] font-medium disabled:opacity-50";

export function DeleteAccount({ disabled }: { disabled: boolean }) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const [state, setState] = useState<Step>({ step: "idle" });
	const [exporting, setExporting] = useState<"idle" | "busy" | "failed">(
		"idle",
	);
	const [phrase, setPhrase] = useState("");
	const [word, setWord] = useState("");
	const ready = word === t("deleteAccount.word");
	const close = () => setState({ step: "idle" });

	const run = async (proof: { phrase?: string }) => {
		setState({ step: "working" });
		try {
			await deleteAccount(proof);
			setPhrase("");
			setState({ step: "done" });
		} catch (err) {
			const kind = err instanceof DeleteError ? err.kind : "other";
			if (kind === "wrong-phrase")
				setState({
					step: "confirm",
					problem: {
						title: t("deleteAccount.wrongPhrase"),
						desc: t("deleteAccount.wrongPhraseDesc"),
					},
				});
			else if (kind === "not-confirmed")
				setState({
					step: "confirm",
					problem: {
						title: t("deleteAccount.notConfirmed"),
						desc: t("deleteAccount.notConfirmedDesc"),
					},
				});
			else
				setState({
					step: "failed",
					title: t("deleteAccount.offline"),
					desc:
						kind === "other" && err instanceof Error && err.message !== "other"
							? err.message
							: t("deleteAccount.offlineDesc"),
				});
		}
	};

	const wipeDevice = () => {
		try {
			localStorage.setItem(CLEAR_FLAG, "1");
		} catch {
			// Blocked storage: the notes simply stay.
		}
		location.assign("/");
	};

	return (
		<>
			<Row
				label={t("settings.security.delete.label")}
				desc={t("settings.security.delete.desc")}
				note={disabled ? t("common.needsAccount") : undefined}
			>
				<Btn
					danger
					disabled={disabled}
					onClick={() => {
						setWord("");
						setPhrase("");
						setState({ step: "warn" });
					}}
				>
					{t("settings.security.delete.button")}
				</Btn>
			</Row>

			{state.step === "warn" ? (
				<Modal
					title={t("deleteAccount.title")}
					onClose={close}
					actions={
						<>
							<Btn onClick={close}>{t("common.cancel")}</Btn>
							<button
								type="button"
								onClick={() => setState({ step: "confirm" })}
								className={`${button} bg-accent text-white`}
							>
								{t("deleteAccount.continue")}
							</button>
						</>
					}
				>
					<div className="flex flex-col gap-4 px-[22px] py-4">
						<p className="text-[13px] leading-normal text-mute">
							<b className="block text-sm font-medium text-ink">
								{t("deleteAccount.removesLead")}
							</b>
							{t("deleteAccount.removes")}
						</p>
						<div className="flex items-center gap-3.5">
							<p className="min-w-0 flex-1 text-[13px] leading-normal text-mute">
								<b className="block text-sm font-medium text-ink">
									{t("deleteAccount.noUndoLead")}
								</b>
								{t("deleteAccount.noUndo")}
							</p>
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
									? t("deleteAccount.exporting")
									: t("deleteAccount.exportFirst")}
							</Btn>
						</div>
						{exporting === "failed" ? (
							<p role="alert" className="text-[13px] text-accent">
								{t("deleteAccount.exportFailed")}
							</p>
						) : null}
					</div>
				</Modal>
			) : null}

			{state.step === "confirm" ? (
				<Modal
					title={t("deleteAccount.confirmTitle")}
					onClose={close}
					actions={
						<>
							<Btn onClick={() => setState({ step: "warn" })}>
								{t("deleteAccount.back")}
							</Btn>
							<button
								type="button"
								disabled={!ready || phrase.trim() === ""}
								onClick={() => void run({ phrase })}
								className={`${button} bg-accent text-white`}
							>
								{t("deleteAccount.delete")}
							</button>
						</>
					}
				>
					<div className="flex flex-col gap-4 px-[22px] py-4">
						{state.problem ? (
							<p
								role="alert"
								className="text-[13px] leading-normal text-accent"
							>
								<b className="block text-sm font-medium">
									{state.problem.title}
								</b>
								{state.problem.desc}
							</p>
						) : null}
						<label className="flex flex-col gap-1.5 text-sm font-medium">
							{t("deleteAccount.typeWord", { word: t("deleteAccount.word") })}
							<input
								value={word}
								onChange={(e) => setWord(e.target.value)}
								autoComplete="off"
								className="h-10 w-40 rounded-full border border-line bg-raised px-3.5 text-sm text-ink outline-none focus:border-mute"
							/>
						</label>
						<div className="flex items-center gap-3.5">
							<p className="min-w-0 flex-1 text-[13px] leading-normal text-mute">
								<b className="block text-sm font-medium text-ink">
									{t("deleteAccount.passkey")}
								</b>
								{t("deleteAccount.passkeyDesc")}
							</p>
							<Btn disabled={!ready} onClick={() => void run({})}>
								{t("deleteAccount.passkeyButton")}
							</Btn>
						</div>
						<label className="flex flex-col gap-1.5 text-sm font-medium">
							{t("deleteAccount.phrase")}
							<span className="text-[13px] font-normal text-mute">
								{t("deleteAccount.phraseDesc")}
							</span>
							<input
								value={phrase}
								onChange={(e) => setPhrase(e.target.value)}
								placeholder={t("deleteAccount.phrasePlaceholder")}
								autoComplete="off"
								autoCapitalize="none"
								spellCheck={false}
								className="h-10 w-full rounded-full border border-line bg-raised px-3.5 text-sm font-normal text-ink outline-none focus:border-mute"
							/>
						</label>
					</div>
				</Modal>
			) : null}

			{state.step === "working" ? (
				<Modal title={t("deleteAccount.workingTitle")} onClose={() => {}}>
					<div className="flex flex-col gap-3 px-[22px] py-4">
						<b className="text-sm font-medium">{t("deleteAccount.working")}</b>
						<span className="text-[13px] text-mute">
							{t("deleteAccount.keepOpen")}
						</span>
					</div>
				</Modal>
			) : null}

			{state.step === "failed" ? (
				<Modal
					title={t("deleteAccount.failTitle")}
					onClose={close}
					actions={
						<button
							type="button"
							onClick={close}
							className={`${button} bg-ink text-paper`}
						>
							{t("common.ok")}
						</button>
					}
				>
					<div className="flex flex-col gap-1 px-[22px] py-4">
						<b className="text-sm font-medium">{state.title}</b>
						<span className="text-[13px] leading-normal text-mute">
							{state.desc}
						</span>
					</div>
				</Modal>
			) : null}

			{state.step === "done" ? (
				<Modal
					title={t("deleteAccount.doneTitle")}
					onClose={() => {
						close();
						void navigate({ to: "/" });
					}}
					actions={
						<>
							<Btn
								onClick={() => {
									close();
									void navigate({ to: "/" });
								}}
							>
								{t("deleteAccount.keepOnDevice")}
							</Btn>
							<button
								type="button"
								onClick={wipeDevice}
								className={`${button} bg-ink text-paper`}
							>
								{t("deleteAccount.wipeDevice")}
							</button>
						</>
					}
				>
					<p className="px-[22px] py-4 text-sm leading-relaxed text-ink2">
						{t("deleteAccount.done")}
					</p>
				</Modal>
			) : null}
		</>
	);
}
