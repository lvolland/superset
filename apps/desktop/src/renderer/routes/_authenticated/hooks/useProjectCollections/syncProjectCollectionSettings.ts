import { PROJECTS_TAG_SCOPE } from "@superset/shared/workspace-tags";
import {
	type HostTagFolderSetting,
	type HostTagFoldersResult,
	mergeHostTagFolders,
} from "renderer/hooks/host-projects/useHostTagFolders/useHostTagFolders.utils";

export async function syncProjectCollectionSettings({
	hosts,
	upsert,
}: {
	hosts: HostTagFoldersResult[];
	upsert: (
		host: HostTagFoldersResult,
		setting: HostTagFolderSetting,
	) => Promise<unknown>;
}) {
	const local = hosts.find((host) => host.target.isLocal);
	if (!local || local.status !== "ready") return;
	const settings = mergeHostTagFolders([local]).filter(
		(row) => row.scope === PROJECTS_TAG_SCOPE,
	);
	for (const host of hosts) {
		if (host.target.isLocal || host.status !== "ready" || !host.target.hostUrl)
			continue;
		for (const setting of settings) {
			const prior = host.settings.find(
				(row) => row.scope === setting.scope && row.tag === setting.tag,
			);
			if (
				prior &&
				prior.displayName === setting.displayName &&
				prior.color === setting.color &&
				prior.tabOrder === setting.tabOrder
			)
				continue;
			await upsert(host, setting);
		}
	}
}
