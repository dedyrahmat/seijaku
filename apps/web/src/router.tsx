import {
	createRootRoute,
	createRoute,
	createRouter,
} from "@tanstack/react-router";
import { Home } from "./pages/Home";
import { ImportPage } from "./pages/ImportPage";
import { NotePage } from "./pages/NotePage";
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

export const router = createRouter({
	routeTree: rootRoute.addChildren([
		homeRoute,
		noteRoute,
		trashRoute,
		importRoute,
		settingsRoute,
	]),
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
