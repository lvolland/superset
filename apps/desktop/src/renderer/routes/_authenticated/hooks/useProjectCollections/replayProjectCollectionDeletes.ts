import { PROJECTS_TAG_SCOPE } from "@superset/shared/workspace-tags";
import type { HostTagFoldersResult } from "renderer/hooks/host-projects/useHostTagFolders/useHostTagFolders.utils";
import { isMissingProcedureError } from "renderer/lib/isMissingProcedureError";
import type { ProjectCollectionPendingDelete } from "shared/project-collections";

export function withoutPendingProjectCollections(
	hosts: HostTagFoldersResult[],
	pending: readonly ProjectCollectionPendingDelete[],
): HostTagFoldersResult[] {
	return hosts.map((host) => {
		const tags = new Set(
			pending
				.filter((row) => row.machineId === host.target.machineId)
				.map((row) => row.tag),
		);
		return {
			...host,
			settings: host.settings.filter(
				(row) => row.scope !== PROJECTS_TAG_SCOPE || !tags.has(row.tag),
			),
		};
	});
}

export async function replayProjectCollectionDeletes({
	hosts,
	pending,
	remove,
	acknowledge,
	enqueue = (work) => work(),
	readPending = () => pending,
	invalidate = () => {},
}: {
	hosts: HostTagFoldersResult[];
	pending: readonly ProjectCollectionPendingDelete[];
	remove: (hostUrl: string, tag: string) => Promise<unknown>;
	acknowledge: (row: ProjectCollectionPendingDelete) => Promise<unknown>;
	enqueue?: (work: () => Promise<void>) => Promise<void>;
	readPending?: () => readonly ProjectCollectionPendingDelete[];
	invalidate?: (host: HostTagFoldersResult) => void;
}) {
	const touched = new Map<string, HostTagFoldersResult>();
	for (const row of pending) {
		const host = hosts.find((host) => host.target.machineId === row.machineId);
		if (
			!host?.target.hostUrl ||
			(host.status !== "ready" && host.status !== "error")
		)
			continue;
		try {
			await enqueue(async () => {
				if (
					!readPending().some(
						(entry) =>
							entry.machineId === row.machineId && entry.tag === row.tag,
					)
				)
					return;
				try {
					await remove(host.target.hostUrl as string, row.tag);
					touched.set(row.machineId, host);
				} catch (error) {
					const code =
						error && typeof error === "object"
							? (error as { data?: { code?: string } }).data?.code
							: undefined;
					if (!isMissingProcedureError(error) && code !== "BAD_REQUEST") return;
				}
				await acknowledge(row);
			});
		} catch {}
	}
	for (const host of touched.values()) invalidate(host);
}
