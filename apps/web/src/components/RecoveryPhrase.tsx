import { normalisePhrase, PHRASE_WORDS } from "@seijaku/sync";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/** A recovery phrase as numbered words (like a wallet's), with Copy and Download, and a field to type one. */

export function PhraseGrid({ phrase }: { phrase: string }) {
	const { t } = useTranslation();
	const words = phrase.split(" ");
	return (
		<ol
			aria-label={t("account.phrase")}
			className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-2xl border border-line bg-raised p-5 font-mono text-[15px] text-ink select-all sm:grid-cols-3"
		>
			{words.map((word, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: the same word can appear twice; position is the identity
				<li key={i} className="flex items-baseline gap-2">
					<span className="w-5 text-right text-xs text-mute">{i + 1}</span>
					<span>{word}</span>
				</li>
			))}
		</ol>
	);
}

const GHOST =
	"h-10 rounded-full border border-line px-[18px] text-sm text-ink hover:bg-hover disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent";

export function PhraseActions({ phrase }: { phrase: string }) {
	const { t } = useTranslation();
	const [copied, setCopied] = useState(false);

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(phrase);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Clipboard blocked: the words are selectable on screen.
		}
	};

	const download = () => {
		const text = `${t("phrase.fileHeader")}

${phrase}
`;
		const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
		const a = document.createElement("a");
		a.href = url;
		a.download = "seijaku-recovery-phrase.txt";
		a.click();
		URL.revokeObjectURL(url);
	};

	return (
		<div className="flex gap-2.5">
			<button type="button" onClick={() => void copy()} className={GHOST}>
				{copied ? t("common.copied") : t("phrase.copy")}
			</button>
			<button type="button" onClick={download} className={GHOST}>
				{t("phrase.download")}
			</button>
		</div>
	);
}

/** One box for all twelve words: pasting from a wallet or a password manager just works. */
export function PhraseField({
	id,
	value,
	onChange,
	autoFocus,
}: {
	id: string;
	value: string;
	onChange: (v: string) => void;
	autoFocus?: boolean;
}) {
	const { t } = useTranslation();
	const box = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		if (autoFocus) box.current?.focus();
	}, [autoFocus]);
	const count = normalisePhrase(value).split(" ").filter(Boolean).length;
	return (
		<div className="flex flex-col gap-1.5">
			<label htmlFor={id} className="sr-only">
				{t("phrase.label")}
			</label>
			<textarea
				id={id}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				ref={box}
				rows={3}
				spellCheck={false}
				autoComplete="off"
				autoCapitalize="none"
				placeholder={t("phrase.placeholder")}
				className="resize-none rounded-2xl border border-line bg-raised px-3.5 py-3 font-mono text-[15px] leading-relaxed text-ink outline-none placeholder:font-sans placeholder:text-mute focus:border-mute"
			/>
			<span className="text-xs text-mute">
				{count} of {PHRASE_WORDS} words
			</span>
		</div>
	);
}
