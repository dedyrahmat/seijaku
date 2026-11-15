import { createApp } from "./app";
import { R2BlobStore } from "./r2-blobs";

export { WorkspaceRoom } from "./room-do";

interface Env {
	WORKSPACE_ROOM: DurableObjectNamespace;
	BLOBS: R2Bucket;
}

/**
 * Cloudflare entry point. HTTP goes to the shared Hono app; the sync WebSocket is handed to
 * the workspace's Durable Object. One workspace for now, so one fixed object name.
 */
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);
		if (url.pathname === "/sync") {
			if (request.headers.get("Upgrade") !== "websocket") {
				return new Response("Expected a WebSocket upgrade", { status: 426 });
			}
			const id = env.WORKSPACE_ROOM.idFromName("default");
			return env.WORKSPACE_ROOM.get(id).fetch(request);
		}
		return createApp(new R2BlobStore(env.BLOBS)).fetch(request, env, ctx);
	},
};
