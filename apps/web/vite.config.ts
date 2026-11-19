import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
	plugins: [
		react(),
		tailwindcss(),
		VitePWA({
			// A new build installs itself and takes over on the next load; notes live in
			// IndexedDB, so swapping the app shell never touches them.
			registerType: "autoUpdate",
			// Registered by main.tsx so the desktop shell can skip it.
			injectRegister: false,
			manifest: {
				name: "Seijaku",
				short_name: "Seijaku",
				description: "Active calm. The opposite of noise.",
				start_url: "/",
				scope: "/",
				display: "standalone",
				background_color: "#F8F4EB",
				theme_color: "#F8F4EB",
				icons: [
					{ src: "/icon-192.png", sizes: "192x192", type: "image/png" },
					{ src: "/icon-512.png", sizes: "512x512", type: "image/png" },
					{
						src: "/icon-maskable-512.png",
						sizes: "512x512",
						type: "image/png",
						purpose: "maskable",
					},
				],
			},
			workbox: {
				// The editor bundle is large (BlockNote, syntax highlighting, KaTeX).
				maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
				// Fonts load by script range; keep only the Latin ones offline.
				globIgnores: [
					"**/*-{cyrillic,cyrillic-ext,greek,greek-ext,vietnamese}-*.woff*",
				],
				navigateFallback: "/index.html",
				navigateFallbackDenylist: [/^\/api\//, /^\/sync/],
				runtimeCaching: [
					{
						// Attachments are sealed, content-addressed files: once seen, keep them for offline.
						urlPattern: ({ url }) => url.pathname.startsWith("/api/files/"),
						handler: "CacheFirst",
						options: {
							cacheName: "seijaku-files",
							cacheableResponse: { statuses: [200] },
							expiration: { maxEntries: 200 },
						},
					},
				],
			},
		}),
	],
	server: {
		port: 5173,
		// In development the sync server runs beside Vite; the app talks to it on the same origin.
		proxy: {
			"/sync": { target: "http://localhost:8791", ws: true },
			"/api": "http://localhost:8791",
		},
	},
});
