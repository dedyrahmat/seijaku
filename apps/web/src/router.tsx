import {
	createRootRoute,
	createRoute,
	createRouter,
	lazyRouteComponent,
} from "@tanstack/react-router";
import {
	DesktopLinkPage,
	RecoveryPage,
	SetupPage,
	SignInPage,
	UnlockPage,
} from "./pages/AuthPages";
import { CapturePage } from "./pages/CapturePage";
import { Home } from "./pages/Home";
import { NotePage } from "./pages/NotePage";
import { QuickNotesPage } from "./pages/QuickNotesPage";
import { Shell } from "./pages/Shell";
import { TrashPage } from "./pages/TrashPage";

const rootRoute = createRootRoute({ component: Shell });

const homeRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: Home,
});

const noteRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/page/$slug",
	component: NotePage,
});

const quickRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/quick-notes",
	component: QuickNotesPage,
});

const quickCardRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/quick-notes/$slug",
	component: QuickNotesPage,
});

const trashRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/trash",
	component: TrashPage,
});

const importRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/import",
	component: lazyRouteComponent(
		() => import("./pages/ImportPage"),
		"ImportPage",
	),
});

const settingsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/settings",
	component: lazyRouteComponent(
		() => import("./pages/SettingsPage"),
		"SettingsPage",
	),
});

const settingsSectionRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/settings/$section",
	component: lazyRouteComponent(
		() => import("./pages/SettingsPage"),
		"SettingsPage",
	),
});

const signInRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/sign-in",
	component: SignInPage,
});

const setupRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/setup",
	component: SetupPage,
});

const recoveryRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/recovery-phrase",
	component: RecoveryPage,
});

const unlockRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/unlock",
	component: UnlockPage,
});

const desktopLinkRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/desktop-link",
	component: DesktopLinkPage,
});

const captureRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/capture",
	component: CapturePage,
});

const publicRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/share/$token",
	component: lazyRouteComponent(
		() => import("./pages/PublicPage"),
		"PublicPage",
	),
});

export const router = createRouter({
	routeTree: rootRoute.addChildren([
		homeRoute,
		noteRoute,
		quickRoute,
		quickCardRoute,
		trashRoute,
		importRoute,
		settingsRoute,
		settingsSectionRoute,
		signInRoute,
		setupRoute,
		recoveryRoute,
		unlockRoute,
		captureRoute,
		desktopLinkRoute,
		publicRoute,
	]),
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
