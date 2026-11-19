import { dailyTitle } from "@seijaku/sync";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { authStore } from "../auth/session";
import { Logo } from "../components/Logo";
import { hideThisWindow, isCaptureWindow } from "../desktop";
import { captureToToday } from "../workspace/capture";
import { useWorkspaceReady } from "../workspace/hooks";

/** The mockup's "Quick capture" window: one box, Enter to save, Esc to close. */
export function CapturePage() {
	const navigate = useNavigate();
	const ready = useWorkspaceReady();
	const [text, setText] = useState("");
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const box = useRef<HTMLTextAreaElement>(null);
	const today = new Date();

	useEffect(() => {
		document.title = "Quick capture · Seijaku";
	}, []);

	// The hotkey window is shown and hidden, never reloaded: take focus each time it appears.
	useEffect(() => {
		if (!isCaptureWindow) return;
		const focus = () => {
			box.current?.focus();
			// Signed in or unlocked in the main window since this window was made.
			void authStore.changed();
		};
		window.addEventListener("focus", focus);
		document.documentElement.style.background = "transparent";
		document.body.style.background = "transparent";
		return () => window.removeEventListener("focus", focus);
	}, []);

	const close = () => {
		if (isCaptureWindow) return void hideThisWindow();
		if (window.history.length > 1) window.history.back();
		else void navigate({ to: "/" });
	};

	const save = async () => {
		if (!text.trim() || saving || !ready) return;
		setSaving(true);
		await captureToToday(text);
		setText("");
		setSaving(false);
		setSaved(true);
		if (isCaptureWindow) return void hideThisWindow(); // the window closes on Enter
		box.current?.focus();
	};

	const date = today.toLocaleDateString("en-GB", {
		weekday: "short",
		day: "numeric",
		month: "short",
	});

	return (
		<div
			className={`flex min-h-dvh items-center justify-center p-4 ${isCaptureWindow ? "" : "bg-hover"}`}
		>
			<div
				role="dialog"
				aria-label="Quick capture"
				className="flex h-60 w-[440px] max-w-full flex-col overflow-hidden rounded-2xl border border-line bg-paper text-ink shadow-[0_24px_60px_rgba(40,30,15,0.25),0_2px_8px_rgba(40,30,15,0.12)]"
			>
				<div className="flex h-12 flex-none items-center gap-2.5 border-b border-line2 px-4">
					<Logo size={18} />
					<span
						title={dailyTitle(today)}
						className="flex h-[30px] items-center gap-1.5 rounded-2xl bg-tag px-2.5 text-[13px]"
					>
						Add to Today
						<svg
							width="12"
							height="12"
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.6"
							strokeLinecap="round"
							strokeLinejoin="round"
							aria-hidden="true"
						>
							<path d="M4 6l4 4 4-4" />
						</svg>
					</span>
					<span className="flex-1" />
					<span className="text-xs text-mute">{date}</span>
				</div>
				<div className="flex flex-1 flex-col px-[18px] py-3.5">
					<label htmlFor="capture" className="sr-only">
						Capture
					</label>
					<textarea
						id="capture"
						ref={box}
						// biome-ignore lint/a11y/noAutofocus: the window exists to be typed into
						autoFocus
						value={text}
						placeholder="Write something down"
						onChange={(e) => {
							setText(e.target.value);
							setSaved(false);
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								// keyCode 229: Safari reports the IME-confirming Enter after isComposing resets
								if (e.nativeEvent.isComposing || e.keyCode === 229) return;
								void save();
							} else if (e.key === "Escape") close();
						}}
						className="flex-1 resize-none border-0 bg-transparent p-0 text-base leading-[1.6] text-ink outline-none focus-visible:outline-none placeholder:text-mute"
					/>
				</div>
				<div className="flex h-[42px] flex-none items-center gap-3.5 border-t border-line2 px-4 text-xs text-mute">
					<span>Enter to save</span>
					<span>Shift Enter new line</span>
					<span className="flex-1" />
					<span role="status">{saved ? "Saved to Today" : "Esc to close"}</span>
				</div>
			</div>
		</div>
	);
}
