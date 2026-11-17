import "@fontsource-variable/hanken-grotesk";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/newsreader";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { authStore } from "./auth/session";
import { initPrefs } from "./preferences";
import { router } from "./router";
import { startFileQueue } from "./workspace/files";
import "./styles.css";

initPrefs();
void authStore.refresh();
startFileQueue();

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
	<StrictMode>
		<RouterProvider router={router} />
	</StrictMode>,
);
