import { SuggestionMenu } from "@blocknote/core/extensions";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { askText } from "../components/Dialogs";
import { i18n } from "../i18n";
import type { schema } from "./schema";

type SeijakuEditor = import("@blocknote/core").BlockNoteEditor<
	typeof schema.blockSchema,
	typeof schema.inlineContentSchema,
	typeof schema.styleSchema
>;

/** How far the on-screen keyboard covers the layout viewport (iPhone Safari does not resize it). */
function useKeyboardInset(): number {
	const [inset, setInset] = useState(0);
	useEffect(() => {
		const vv = window.visualViewport;
		if (!vv) return;
		const update = () =>
			setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
		update();
		vv.addEventListener("resize", update);
		vv.addEventListener("scroll", update);
		return () => {
			vv.removeEventListener("resize", update);
			vv.removeEventListener("scroll", update);
		};
	}, []);
	return inset;
}

const HEADINGS = [undefined, 1, 2, 3] as const;

/**
 * The phone board's floating formatting bar: insert block, text style, to-do, link, undo.
 * It rides above the keyboard, and buttons keep focus in the editor so the keyboard stays up.
 */
export function MobileToolbar({ editor }: { editor: SeijakuEditor }) {
	const { t } = useTranslation();
	const inset = useKeyboardInset();

	const block = () => editor.getTextCursorPosition().block;
	const run = (fn: () => void) => () => {
		editor.focus();
		fn();
	};
	const insertBlock = () =>
		editor.getExtension(SuggestionMenu)?.openSuggestionMenu("/");
	const cycleStyle = () => {
		const b = block();
		const now = b.type === "heading" ? (b.props.level as number) : undefined;
		const next = HEADINGS[(HEADINGS.indexOf(now as 1) + 1) % HEADINGS.length];
		editor.updateBlock(
			b,
			next
				? { type: "heading", props: { level: next } }
				: { type: "paragraph" },
		);
	};
	const toggleTodo = () => {
		const b = block();
		editor.updateBlock(
			b,
			b.type === "checkListItem"
				? { type: "paragraph" }
				: { type: "checkListItem" },
		);
	};
	const link = async () => {
		const url = await askText(i18n.t("toolbar.linkPrompt"));
		if (url) editor.createLink(url);
	};

	return (
		<>
			<div
				aria-hidden
				className="pointer-events-none fixed inset-x-0 bottom-0 z-20 h-[190px] bg-gradient-to-b from-transparent to-paper md:hidden"
			/>
			<div
				role="toolbar"
				aria-label={t("toolbar.formatting")}
				style={{
					bottom: `calc(${inset}px + max(12px, env(safe-area-inset-bottom)))`,
				}}
				className="fixed inset-x-4 z-30 flex h-14 items-center justify-around rounded-full border border-line bg-raised px-1.5 shadow-[0_10px_30px_rgba(40,30,15,0.14),0_2px_6px_rgba(40,30,15,0.08)] md:hidden"
			>
				<Btn label={t("toolbar.insertBlock")} onPress={run(insertBlock)}>
					<path d="M8 3v10M3 8h10" />
				</Btn>
				<button
					type="button"
					aria-label={t("toolbar.textStyle")}
					onPointerDown={(e) => e.preventDefault()}
					onClick={run(cycleStyle)}
					className="flex size-11 items-center justify-center rounded-full font-serif text-xl text-ink"
				>
					Aa
				</button>
				<Btn label={t("toolbar.todo")} onPress={run(toggleTodo)}>
					<rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
					<path d="M5.5 8.2l1.8 1.8 3.2-3.8" />
				</Btn>
				<Btn label={t("toolbar.link")} onPress={run(link)}>
					<path d="M6.5 9.5l3-3M5 7.5L3.8 8.7a2.5 2.5 0 003.5 3.5L8.5 11M11 8.5l1.2-1.2a2.5 2.5 0 00-3.5-3.5L7.5 5" />
				</Btn>
				<Btn label={t("toolbar.undo")} onPress={run(() => editor.undo())}>
					<path d="M5.5 3.5L3 6l2.5 2.5M3.5 6H10a3 3 0 010 6H7" />
				</Btn>
			</div>
		</>
	);
}

function Btn({
	label,
	onPress,
	children,
}: {
	label: string;
	onPress: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			onPointerDown={(e) => e.preventDefault()}
			onClick={onPress}
			className="flex size-11 items-center justify-center rounded-full text-ink"
		>
			<svg
				width="22"
				height="22"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.4"
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
			>
				{children}
			</svg>
		</button>
	);
}
