import "./clearPending";
import "@fontsource-variable/hanken-grotesk";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/newsreader";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { authStore } from "./auth/session";
import { ContextMenu } from "./components/ContextMenu";
import { DialogHost } from "./components/Dialogs";
import { initDesktop, isCaptureWindow, isDesktop } from "./desktop";
import { initI18n } from "./i18n";
import { initPrefs } from "./preferences";
import { router } from "./router";
import { initScrollbars } from "./scrollbars";
import { openStartPage } from "./startPage";
import { startFileQueue } from "./workspace/files";
import "./styles.css";

initPrefs();
initScrollbars();
initI18n();
startFileQueue();

// The desktop app needs its token loaded before the first request; the PWA worker is for browsers only.
// The capture window is opened at the app root; take it to its page.
if (isCaptureWindow) router.history.replace("/capture");
await initDesktop(() => void router.navigate({ to: "/" }));
void authStore.refresh();
if (!isCaptureWindow) void openStartPage(router);
if (!isDesktop)
	void import("virtual:pwa-register").then((m) =>
		m.registerSW({ immediate: true }),
	);

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
	<StrictMode>
		<RouterProvider router={router} />
		<ContextMenu />
		<DialogHost />
	</StrictMode>,
);
