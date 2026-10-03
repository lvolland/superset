import {
	normalizeWorkspaceTag,
	PROJECTS_TAG_SCOPE,
} from "@superset/shared/workspace-tags";
import type { HostProjectRowsResult } from "renderer/hooks/host-projects/useHostProjects/useHostProjects.utils";
import type {
	HostTagFolderSetting,
	HostTagFoldersResult,
} from "renderer/hooks/host-projects/useHostTagFolders/useHostTagFolders.utils";
import { isMissingProcedureError } from "renderer/lib/isMissingProcedureError";
import type { ProjectCollectionPlacement } from "shared/project-collections";
import {
	deriveProjectCollections,
	projectCollectionId,
} from "../../utils/projectCollections/projectCollections";

export type ProjectCollectionCommand =
	| { type: "move"; projectIds: string[]; tag: string | null; index?: number }
	| { type: "create"; tag: string; name: string; projectIds?: string[] }
	| { type: "rename"; tag: string; name: string }
	| { type: "color"; tag: string; color: string | null }
	| { type: "delete"; tag: string }
	| { type: "collapse"; tag: string; isCollapsed: boolean }
	| { type: "reorder"; keys: string[] };

export interface ProjectCollectionMutationState {
	projectHosts: HostProjectRowsResult[];
	folderHosts: HostTagFoldersResult[];
	placements: ProjectCollectionPlacement[];
}

export interface ProjectCollectionMutationAdapter {
	read(): ProjectCollectionMutationState;
	publish(state: ProjectCollectionMutationState): void;
	setTags(
		hostUrl: string,
		updates: Array<{ projectId: string; tags: string[] }>,
	): Promise<unknown>;
	setSetting(
		hostUrl: string,
		tag: string,
		setting: HostTagFolderSetting | null,
	): Promise<unknown>;
	writePlacements(
		rows: ProjectCollectionPlacement[],
		removeKeys: string[],
	): Promise<unknown>;
	invalidate(): void;
}

function requiredTag(value: string): string {
	const tag = normalizeWorkspaceTag(value);
	if (!tag) throw new Error("Invalid collection tag");
	return tag;
}

export async function mutateProjectCollection(
	adapter: ProjectCollectionMutationAdapter,
	command: ProjectCollectionCommand,
): Promise<boolean> {
	const before = adapter.read();
	const next = structuredClone(before);
	const projectMap = new Map<
		string,
		{ id: string; name: string; tags: string[] }
	>();
	for (const host of before.projectHosts)
		for (const row of host.rows ?? []) {
			const previous = projectMap.get(row.id);
			projectMap.set(row.id, {
				id: row.id,
				name: row.name,
				tags: [...new Set([...(previous?.tags ?? []), ...(row.tags ?? [])])],
			});
		}
	const placements = new Map(next.placements.map((row) => [row.key, row]));
	const view = deriveProjectCollections({
		projects: [...projectMap.values()],
		hostResults: before.folderHosts,
		placements: before.placements
			.filter((row) => row.kind === "collection")
			.map((row) => ({
				sectionId: row.key,
				projectId: PROJECTS_TAG_SCOPE,
				tag: row.key.slice(`${PROJECTS_TAG_SCOPE}:`.length),
				name: row.key,
				color: null,
				createdAt: new Date(0),
				tabOrder: row.tabOrder,
				isCollapsed: row.isCollapsed,
			})),
		projectPlacements: before.placements
			.filter((row) => row.kind === "project")
			.map((row) => ({
				projectId: row.key,
				isHidden: false,
				tabOrder: row.tabOrder,
			})),
	});
	const tag =
		"tag" in command && command.tag !== null ? requiredTag(command.tag) : null;
	const collection = tag
		? view.collections.find((row) => row.tag === tag)
		: undefined;
	const projectIds =
		command.type === "move" || command.type === "create"
			? [...new Set(command.projectIds ?? [])]
			: command.type === "delete"
				? [...projectMap.values()]
						.filter((project) => project.tags.includes(tag as string))
						.map((project) => project.id)
				: [];
	if (projectIds.some((id) => !projectMap.has(id))) return false;
	if (command.type === "move" && tag && !collection) return false;
	if (command.type === "create" && collection) return false;
	if (
		["rename", "color", "delete", "collapse"].includes(command.type) &&
		!collection
	)
		return false;
	for (const id of projectIds) {
		const hosts = before.projectHosts.filter((host) =>
			host.rows?.some((row) => row.id === id),
		);
		if (
			!hosts.length ||
			hosts.some(
				(host) =>
					!host.target.hostUrl ||
					!host.reachable ||
					!host.rows?.find((row) => row.id === id)?.supportsProjectTags,
			)
		)
			return false;
	}
	const settingWrite = ["create", "rename", "color", "delete"].includes(
		command.type,
	);
	if (
		settingWrite &&
		(!before.folderHosts.length ||
			before.folderHosts.some(
				(host) => !host.target.hostUrl || host.status !== "ready",
			))
	)
		return false;
	if (
		(command.type === "rename" || command.type === "create") &&
		(!command.name.trim() || command.name.trim().length > 200)
	)
		throw new Error("Invalid collection name");
	const tagWrites: Array<{
		url: string;
		updates: Array<{ projectId: string; tags: string[] }>;
		rollback: Array<{ projectId: string; tags: string[] }>;
	}> = [];
	for (const host of next.projectHosts) {
		const updates: Array<{ projectId: string; tags: string[] }> = [];
		const rollback: Array<{ projectId: string; tags: string[] }> = [];
		for (const row of host.rows ?? []) {
			if (!projectIds.includes(row.id)) continue;
			rollback.push({ projectId: row.id, tags: row.tags ?? [] });
			row.tags =
				command.type === "delete"
					? view.collectionByProjectId.get(row.id)?.tag === tag
						? []
						: (row.tags ?? []).filter((entry) => entry !== tag)
					: tag === null
						? []
						: [tag];
			updates.push({ projectId: row.id, tags: row.tags });
		}
		if (updates.length && host.target.hostUrl)
			tagWrites.push({ url: host.target.hostUrl, updates, rollback });
	}
	const settingWrites: Array<{
		url: string;
		setting: HostTagFolderSetting | null;
		rollback: HostTagFolderSetting | null;
	}> = [];
	if (settingWrite && tag)
		for (const host of next.folderHosts) {
			const prior =
				host.settings.find(
					(row) => row.scope === PROJECTS_TAG_SCOPE && row.tag === tag,
				) ?? null;
			const setting: HostTagFolderSetting | null =
				command.type === "delete"
					? null
					: {
							scope: PROJECTS_TAG_SCOPE,
							tag,
							displayName:
								command.type === "rename" || command.type === "create"
									? command.name.trim()
									: (collection?.name ?? prior?.displayName ?? null),
							color:
								command.type === "color"
									? command.color
									: (collection?.color ?? null),
							tabOrder:
								prior?.tabOrder ??
								collection?.tabOrder ??
								Math.max(0, ...view.rootItems.map((row) => row.tabOrder)) + 1,
						};
			host.settings = host.settings.filter(
				(row) => row.scope !== PROJECTS_TAG_SCOPE || row.tag !== tag,
			);
			if (setting) host.settings.push(setting);
			settingWrites.push({
				url: host.target.hostUrl as string,
				setting,
				rollback: prior,
			});
		}
	const setOrder = (
		identity: string,
		kind: "project" | "collection",
		tabOrder: number,
	) => {
		const key =
			kind === "collection" ? projectCollectionId(identity) : identity;
		placements.set(key, {
			key,
			kind,
			tabOrder,
			isCollapsed: placements.get(key)?.isCollapsed ?? false,
		});
	};
	if (command.type === "create" && tag)
		setOrder(
			tag,
			"collection",
			Math.max(0, ...view.rootItems.map((row) => row.tabOrder)) + 1,
		);
	if (command.type === "collapse" && tag)
		placements.set(projectCollectionId(tag), {
			key: projectCollectionId(tag),
			kind: "collection",
			tabOrder: collection?.tabOrder ?? 0,
			isCollapsed: command.isCollapsed,
		});
	if (command.type === "reorder")
		command.keys.forEach((key, index) => {
			const folder = view.collections.find((row) => row.id === key);
			if (folder) setOrder(folder.tag, "collection", index);
			else if (projectMap.has(key)) setOrder(key, "project", index);
		});
	if (command.type === "move" || command.type === "create") {
		const members = tag
			? (collection?.projects.map((project) => project.id) ?? [])
			: view.rootItems
					.filter((row) => row.type === "project")
					.map((row) => row.project.id);
		const keys = tag
			? members
			: view.rootItems.map((row) =>
					row.type === "project" ? row.project.id : row.collection.id,
				);
		const ordered = keys.filter((key) => !projectIds.includes(key));
		ordered.splice(
			command.type === "move"
				? (command.index ?? ordered.length)
				: ordered.length,
			0,
			...projectIds,
		);
		ordered.forEach((key, index) => {
			const folder = view.collections.find((row) => row.id === key);
			setOrder(folder?.tag ?? key, folder ? "collection" : "project", index);
		});
	}
	if (command.type === "delete" && tag) {
		const keys = view.rootItems.flatMap((row) =>
			row.type === "collection" && row.collection.tag === tag
				? row.collection.projects.map((project) => project.id)
				: [row.type === "project" ? row.project.id : row.collection.id],
		);
		keys.forEach((key, index) => {
			const folder = view.collections.find((row) => row.id === key);
			setOrder(folder?.tag ?? key, folder ? "collection" : "project", index);
		});
		placements.delete(projectCollectionId(tag));
	}
	next.placements = [...placements.values()];
	adapter.publish(next);
	const undo: Array<() => Promise<unknown>> = [];
	try {
		const settled = await Promise.allSettled(
			tagWrites.map(async (write) => {
				await adapter.setTags(write.url, write.updates);
				undo.push(() => adapter.setTags(write.url, write.rollback));
			}),
		);
		const tagFailure = settled.find((result) => result.status === "rejected");
		if (tagFailure?.status === "rejected") throw tagFailure.reason;
		const settings = await Promise.allSettled(
			settingWrites.map(async (write) => {
				await adapter.setSetting(write.url, tag as string, write.setting);
				undo.push(() =>
					adapter.setSetting(write.url, tag as string, write.rollback),
				);
			}),
		);
		const settingFailure = settings.find(
			(result) => result.status === "rejected",
		);
		if (settingFailure?.status === "rejected") throw settingFailure.reason;
		await adapter.writePlacements(
			next.placements,
			before.placements
				.filter((row) => !placements.has(row.key))
				.map((row) => row.key),
		);
		return true;
	} catch (error) {
		await Promise.allSettled(undo.reverse().map((rollback) => rollback()));
		adapter.publish(before);
		if (isMissingProcedureError(error)) {
			for (const host of before.projectHosts)
				for (const row of host.rows ?? [])
					if (projectIds.includes(row.id)) row.supportsProjectTags = false;
			adapter.publish(before);
			return false;
		}
		throw error;
	} finally {
		adapter.invalidate();
	}
}
