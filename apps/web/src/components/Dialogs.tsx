import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "./DeviceSettings";

/** Styled stand-ins for window.confirm and window.prompt: `await askConfirm(...)` from any code. */

interface Ask {
	title: string;
	/** Present for a text question; its value is the starting text. */
	text?: string;
	confirm?: string;
	danger?: boolean;
	done: (answer: string | boolean | null) => void;
}

let current: Ask | null = null;
const listeners = new Set<() => void>();
const show = (ask: Ask | null) => {
	current = ask;
	for (const l of listeners) l();
};

export function askConfirm(
	title: string,
	opts: { confirm?: string; danger?: boolean } = {},
): Promise<boolean> {
	return new Promise((resolve) =>
		show({ title, ...opts, done: (a) => resolve(a === true) }),
	);
}

/** Resolves to the typed text, or null when cancelled. */
export function askText(title: string): Promise<string | null> {
	return new Promise((resolve) =>
		show({
			title,
			text: "",
			done: (a) => resolve(typeof a === "string" ? a : null),
		}),
	);
}

/** Mount once, beside the context menu. */
export function DialogHost() {
	const { t } = useTranslation();
	const [ask, setAsk] = useState<Ask | null>(current);
	const [text, setText] = useState("");
	useEffect(() => {
		const l = () => {
			setAsk(current);
			setText(current?.text ?? "");
		};
		listeners.add(l);
		return () => void listeners.delete(l);
	}, []);
	if (!ask) return null;
	const close = (answer: string | boolean | null) => {
		show(null);
		ask.done(answer);
	};
	const isText = ask.text !== undefined;
	const accept = () => close(isText ? text.trim() || null : true);
	return (
		<Modal
			title={ask.title}
			onClose={() => close(null)}
			actions={
				<>
					<button
						type="button"
						onClick={() => close(null)}
						className="h-9 rounded-2xl border border-line px-4 text-[13px] font-medium text-ink hover:bg-hover"
					>
						{t("common.cancel")}
					</button>
					<button
						type="button"
						onClick={accept}
						className={`h-9 rounded-2xl px-4 text-[13px] font-medium ${ask.danger ? "bg-accent text-white" : "bg-ink text-paper"}`}
					>
						{ask.confirm ?? t("common.ok")}
					</button>
				</>
			}
		>
			{isText ? (
				<form
					className="px-[22px] py-4"
					onSubmit={(e) => {
						e.preventDefault();
						accept();
					}}
				>
					<input
						// biome-ignore lint/a11y/noAutofocus: the dialog exists to take this answer
						autoFocus
						type="url"
						aria-label={ask.title}
						value={text}
						onChange={(e) => setText(e.target.value)}
						className="h-10 w-full rounded-2xl border border-line bg-raised px-3.5 text-sm text-ink outline-none focus:border-mute"
					/>
				</form>
			) : null}
		</Modal>
	);
}
