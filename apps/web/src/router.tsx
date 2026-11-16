import {
	createRootRoute,
	createRoute,
	createRouter,
} from "@tanstack/react-router";
import { RecoveryPage, SetupPage, SignInPage } from "./pages/AuthPages";
import { CapturePage } from "./pages/CapturePage";
import { Home } from "./pages/Home";
import { ImportPage } from "./pages/ImportPage";
import { NotePage } from "./pages/NotePage";
import { PublicPage } from "./pages/PublicPage";
import { SettingsPage } from "./pages/SettingsPage";
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

const trashRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/trash",
	component: TrashPage,
});

const importRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/import",
	component: ImportPage,
});

const settingsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/settings",
	component: SettingsPage,
});

const settingsSectionRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/settings/$section",
	component: SettingsPage,
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
	path: "/recovery-codes",
	component: RecoveryPage,
});

const captureRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/capture",
	component: CapturePage,
});

const publicRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/share/$token",
	component: PublicPage,
});

export const router = createRouter({
	routeTree: rootRoute.addChildren([
		homeRoute,
		noteRoute,
		trashRoute,
		importRoute,
		settingsRoute,
		settingsSectionRoute,
		signInRoute,
		setupRoute,
		recoveryRoute,
		captureRoute,
		publicRoute,
	]),
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
