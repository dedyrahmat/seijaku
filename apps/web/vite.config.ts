import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	server: {
		port: 5173,
		// In development the sync server runs beside Vite; the app talks to it on the same origin.
		proxy: {
			"/sync": { target: "http://localhost:8791", ws: true },
			"/api": "http://localhost:8791",
		},
	},
});
