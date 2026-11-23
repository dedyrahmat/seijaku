import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/session";
import { Logo } from "../components/Logo";
import { collab, type Role } from "../workspace/collab";

type Offer = { shareId: string; role: Role; label: string; key: string };

/**
 * Opening an invite link (/invite/<id>#<secret>): the page key inside is sealed under the
 * secret in the #fragment, which never reaches the server. Joining needs an account.
 */
export function InvitePage() {
	const { t } = useTranslation();
	const { id } = useParams({ strict: false }) as { id: string };
	const navigate = useNavigate();
	const auth = useAuth();
	const [offer, setOffer] = useState<"loading" | "invalid" | Offer>("loading");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const signedIn = auth.phase === "signed-in";

	useEffect(() => {
		document.title = `${t("collab.inviteTitle")} · Seijaku`;
		if (!signedIn) return;
		let live = true;
		void collab
			.peek(id, location.hash.slice(1))
			.then((o) => live && setOffer(o ?? "invalid"));
		return () => {
			live = false;
		};
	}, [id, signedIn, t]);

	const join = async () => {
		if (typeof offer === "string") return;
		setBusy(true);
		setError(null);
		try {
			await collab.join(id, offer);
			void navigate({ to: "/shared/$id", params: { id: offer.shareId } });
		} catch {
			setError(t("collab.joinFailed"));
			setBusy(false);
		}
	};

	const h1 = "font-serif text-[34px] leading-[1.15] font-medium";
	return (
		<div className="flex min-h-dvh flex-col bg-paper text-ink">
			<header className="flex h-16 items-center gap-2.5 px-8">
				<Logo size={22} />
				<span className="font-serif text-lg font-medium">Seijaku</span>
			</header>
			<main className="mx-auto w-full max-w-[560px] flex-1 px-6 pt-14 text-center">
				{!signedIn ? (
					<>
						<h1 className={h1}>{t("collab.inviteSignIn")}</h1>
						<p className="mt-3 text-ink2">{t("collab.inviteSignInDesc")}</p>
						<div className="mt-6 flex justify-center gap-2.5">
							<Link
								to="/setup"
								className="rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper"
							>
								{t("collab.createAccount")}
							</Link>
							<Link
								to="/sign-in"
								className="rounded-full border border-line px-5 py-2.5 text-sm"
							>
								{t("account.signIn")}
							</Link>
						</div>
						<p className="mt-4 text-xs text-mute">
							{t("collab.inviteComeBack")}
						</p>
					</>
				) : offer === "loading" ? (
					<p aria-busy="true" className="text-mute">
						{t("public.opening")}
					</p>
				) : offer === "invalid" ? (
					<>
						<h1 className={h1}>{t("collab.invalidTitle")}</h1>
						<p className="mt-3 text-ink2">{t("collab.invalidDesc")}</p>
					</>
				) : (
					<>
						<h1 className={h1}>{t("collab.joinTitle")}</h1>
						<p className="mt-3 text-ink2">
							{t("collab.joinDesc", {
								role: t(`collab.role.${offer.role}`).toLowerCase(),
							})}
						</p>
						{error ? (
							<p role="alert" className="mt-3 text-sm text-accent">
								{error}
							</p>
						) : null}
						<div className="mt-6 flex justify-center gap-2.5">
							<button
								type="button"
								disabled={busy}
								onClick={join}
								className="rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper disabled:opacity-50"
							>
								{t("collab.join")}
							</button>
							<Link
								to="/"
								className="rounded-full border border-line px-5 py-2.5 text-sm"
							>
								{t("collab.notNow")}
							</Link>
						</div>
					</>
				)}
			</main>
		</div>
	);
}
