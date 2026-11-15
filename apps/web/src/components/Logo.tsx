/** The Seijaku mark: ink tile, vermilion enso stroke, and 静 at its centre. */
export function Logo({ size = 24 }: { size?: number }) {
	return (
		<span
			role="img"
			aria-label="Seijaku"
			className="seijaku-mark"
			style={{
				width: size,
				height: size,
				borderRadius: size * 0.29,
				fontSize: size * 0.42,
			}}
		>
			<svg viewBox="0 0 32 32" aria-hidden="true">
				<path
					d="M17 3.4C24.6 3.6 29.8 9.6 28.8 17.2 27.8 24.4 21.4 29.2 14.6 28.4 8 27.6 3.4 21.8 3.8 15.2 4.1 9.8 7.6 5.8 12.4 4.3"
					strokeWidth={size < 40 ? 3.3 : 2.4}
				/>
			</svg>
			<span lang="ja">静</span>
		</span>
	);
}
