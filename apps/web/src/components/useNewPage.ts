import { createNote } from "@seijaku/sync";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { workspace } from "../workspace/store";

/** Returns a function that creates a page (optionally under a parent) and opens it. */
export function useNewPage(): (parentId: string | null) => string {
	const navigate = useNavigate();
	return useCallback(
		(parentId) => {
			const id = createNote(workspace.index, { parentId });
			void navigate({ to: "/n/$noteId", params: { noteId: id } });
			return id;
		},
		[navigate],
	);
}
