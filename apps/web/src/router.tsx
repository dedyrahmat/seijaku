import {
	createRootRoute,
	createRoute,
	createRouter,
} from "@tanstack/react-router";
import { Home } from "./pages/Home";
import { NotePage } from "./pages/NotePage";
import { Shell } from "./pages/Shell";

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

export const router = createRouter({
	routeTree: rootRoute.addChildren([homeRoute, noteRoute]),
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
