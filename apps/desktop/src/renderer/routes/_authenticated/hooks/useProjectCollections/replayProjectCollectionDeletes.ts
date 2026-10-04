import { PROJECTS_TAG_SCOPE } from "@superset/shared/workspace-tags";
import type { HostTagFoldersResult } from "renderer/hooks/host-projects/useHostTagFolders/useHostTagFolders.utils";
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
}: {
	hosts: HostTagFoldersResult[];
	pending: readonly ProjectCollectionPendingDelete[];
	remove: (hostUrl: string, tag: string) => Promise<unknown>;
	acknowledge: (row: ProjectCollectionPendingDelete) => Promise<unknown>;
}) {
	for (const row of pending) {
		const host = hosts.find((host) => host.target.machineId === row.machineId);
		if (!host?.target.hostUrl || host.status !== "ready") continue;
		try {
			await remove(host.target.hostUrl, row.tag);
			await acknowledge(row);
		} catch {}
	}
}
