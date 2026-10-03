import { PROJECTS_TAG_SCOPE } from "@superset/shared/workspace-tags";
import { useLiveQuery } from "@tanstack/react-db";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useHostProjects } from "renderer/hooks/host-projects/useHostProjects";
import {
	getHostProjectsQueryKey,
	type HostProjectRow,
} from "renderer/hooks/host-projects/useHostProjects/useHostProjects.utils";
import { useHostTagFolders } from "renderer/hooks/host-projects/useHostTagFolders";
import type { HostTagFolderSetting } from "renderer/hooks/host-projects/useHostTagFolders/useHostTagFolders.utils";
import { useV2UserPreferences } from "renderer/hooks/useV2UserPreferences";
import { authClient } from "renderer/lib/auth-client";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { isMissingProcedureError } from "renderer/lib/isMissingProcedureError";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import { useHostWorkspaces } from "renderer/routes/_authenticated/providers/HostWorkspacesProvider";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import type { ProjectCollectionPlacement } from "shared/project-collections";
import { deriveProjectCollections } from "../../utils/projectCollections/projectCollections";
import {
	mutateProjectCollection,
	type ProjectCollectionCommand,
	type ProjectCollectionMutationState,
} from "./projectCollectionMutations";

const pendingScopes = new Set<string>();

export function useProjectCollections(filter = "") {
	const projects = useHostProjects();
	const folders = useHostTagFolders();
	const { workspaces, isReady: workspacesReady } = useHostWorkspaces();
	const collections = useCollections();
	const { data: sidebarProjects = [] } = useLiveQuery(
		(q) => q.from({ row: collections.v2SidebarProjects }),
		[collections],
	);
	const { preferences, setHideEmptyProjectCollections } =
		useV2UserPreferences();
	const { activeOrganizationId } = useLocalHostService();
	const { data: session } = authClient.useSession();
	const userId = session?.user.id ?? "";
	const scope = useMemo(
		() => ({ organizationId: activeOrganizationId ?? "", userId }),
		[activeOrganizationId, userId],
	);
	const scopeKey = `${scope.organizationId}\u0000${scope.userId}`;
	const enabled = !!scope.organizationId && !!scope.userId;
	const placementsQuery = electronTrpc.projectCollections.list.useQuery(scope, {
		enabled,
	});
	const write = electronTrpc.projectCollections.write.useMutation();
	const reconcile = electronTrpc.projectCollections.reconcile.useMutation();
	const utils = electronTrpc.useUtils();
	const queryClient = useQueryClient();
	const placements: ProjectCollectionPlacement[] = placementsQuery.data ?? [];
	const current = useRef<ProjectCollectionMutationState>({
		projectHosts: projects.hostResults,
		folderHosts: folders.hostResults,
		placements,
	});
	current.current = {
		projectHosts: projects.hostResults,
		folderHosts: folders.hostResults,
		placements,
	};
	const view = useMemo(
		() =>
			deriveProjectCollections({
				projects: projects.projects,
				hostResults: folders.hostResults,
				placements: placements
					.filter((row) => row.kind === "collection")
					.map((row) => ({
						sectionId: row.key,
						projectId: PROJECTS_TAG_SCOPE,
						tag: row.key.slice(`${PROJECTS_TAG_SCOPE}:`.length),
						name: row.key,
						createdAt: new Date(0),
						color: null,
						tabOrder: row.tabOrder,
						isCollapsed: row.isCollapsed,
					})),
				projectPlacements: projects.projects.map((project) => {
					const local = sidebarProjects.find(
						(row) => row.projectId === project.id,
					);
					return {
						projectId: project.id,
						isHidden: local?.isHidden ?? false,
						tabOrder:
							placements.find(
								(placement) =>
									placement.kind === "project" && placement.key === project.id,
							)?.tabOrder ??
							local?.tabOrder ??
							0,
					};
				}),
				workspaces,
				sortMode: preferences.sidebarProjectSortMode,
				hideEmpty: preferences.hideEmptyProjectCollections,
				filter,
			}),
		[
			projects.projects,
			folders.hostResults,
			placements,
			sidebarProjects,
			workspaces,
			preferences.sidebarProjectSortMode,
			preferences.hideEmptyProjectCollections,
			filter,
		],
	);
	const knownKeys = [
		...projects.projects.map((project) => project.id),
		...view.collections.map((collection) => collection.id),
	]
		.sort()
		.join("\u0000");
	const canReconcile =
		enabled &&
		projects.isReady &&
		folders.isReady &&
		projects.hostResults.every((host) => host.reachable) &&
		folders.hostResults.every((host) => host.status === "ready");
	const lastReconciled = useRef("");
	useEffect(() => {
		const identity = `${scope.organizationId}\u0000${scope.userId}\u0000${knownKeys}`;
		if (
			!canReconcile ||
			pendingScopes.has(scopeKey) ||
			lastReconciled.current === identity
		)
			return;
		lastReconciled.current = identity;
		pendingScopes.add(scopeKey);
		void reconcile
			.mutateAsync({
				...scope,
				keys: knownKeys ? knownKeys.split("\u0000") : [],
			})
			.then(() => utils.projectCollections.list.invalidate(scope))
			.catch(() => {
				lastReconciled.current = "";
			})
			.finally(() => pendingScopes.delete(scopeKey));
	}, [canReconcile, knownKeys, scope, scopeKey, reconcile, utils]);
	const mutate = useCallback(
		async (command: ProjectCollectionCommand) => {
			if (!enabled || !placementsQuery.isSuccess || pendingScopes.has(scopeKey))
				return false;
			pendingScopes.add(scopeKey);
			const baseline = current.current;
			try {
				await Promise.all([
					...current.current.projectHosts.map((host) =>
						queryClient.cancelQueries({
							queryKey: getHostProjectsQueryKey(host.target),
						}),
					),
					...current.current.folderHosts.map((host) =>
						queryClient.cancelQueries({
							queryKey: [
								"host-tag-folders",
								host.target.organizationId,
								host.target.machineId,
							],
						}),
					),
					utils.projectCollections.list.cancel(scope),
				]);
				return await mutateProjectCollection(
					{
						read: () => ({
							...baseline,
							placements: [
								...sidebarProjects
									.filter(
										(row) =>
											!baseline.placements.some(
												(placement) => placement.key === row.projectId,
											),
									)
									.map((row) => ({
										key: row.projectId,
										kind: "project" as const,
										tabOrder: row.tabOrder,
										isCollapsed: false,
									})),
								...baseline.placements,
							],
						}),
						publish: (state) => {
							current.current = state;
							for (const host of state.projectHosts)
								queryClient.setQueryData<HostProjectRow[]>(
									getHostProjectsQueryKey(host.target),
									host.rows,
								);
							for (const host of state.folderHosts)
								queryClient.setQueryData<HostTagFolderSetting[]>(
									[
										"host-tag-folders",
										host.target.organizationId,
										host.target.machineId,
									],
									host.settings,
								);
							utils.projectCollections.list.setData(
								scope,
								state.placements.map((row) => ({ ...row, ...scope })),
							);
						},
						setTags: async (url, updates) => {
							const client = getHostServiceClientByUrl(url);
							if (updates.length === 1)
								return client.project.setTags.mutate(
									updates[0] as (typeof updates)[number],
								);
							try {
								return await client.project.setTagsBatch.mutate({ updates });
							} catch (error) {
								if (!isMissingProcedureError(error)) throw error;
								const prior = baseline.projectHosts.find(
									(host) => host.target.hostUrl === url,
								);
								const settled = await Promise.allSettled(
									updates.map((update) =>
										client.project.setTags.mutate(update),
									),
								);
								const failure = settled.find(
									(result) => result.status === "rejected",
								);
								if (failure?.status === "rejected") {
									await Promise.allSettled(
										updates
											.filter(
												(_, index) => settled[index]?.status === "fulfilled",
											)
											.map((update) =>
												client.project.setTags.mutate({
													projectId: update.projectId,
													tags:
														prior?.rows?.find(
															(row) => row.id === update.projectId,
														)?.tags ?? [],
												}),
											),
									);
									throw failure.reason;
								}
								return settled;
							}
						},
						setSetting: (url, tag, setting) =>
							setting
								? getHostServiceClientByUrl(url).tagFolders.upsert.mutate(
										setting,
									)
								: getHostServiceClientByUrl(url).tagFolders.delete.mutate({
										scope: PROJECTS_TAG_SCOPE,
										tag,
									}),
						writePlacements: (rows, removeKeys) =>
							write.mutateAsync({ ...scope, rows, removeKeys }),
						invalidate: () => {
							for (const host of baseline.projectHosts)
								void queryClient.invalidateQueries({
									queryKey: getHostProjectsQueryKey(host.target),
								});
							for (const host of baseline.folderHosts)
								void queryClient.invalidateQueries({
									queryKey: [
										"host-tag-folders",
										host.target.organizationId,
										host.target.machineId,
									],
								});
							void utils.projectCollections.list.invalidate(scope);
						},
					},
					command,
				);
			} finally {
				pendingScopes.delete(scopeKey);
			}
		},
		[
			enabled,
			placementsQuery.isSuccess,
			scope,
			scopeKey,
			queryClient,
			utils,
			write,
			sidebarProjects,
		],
	);
	return {
		...view,
		isReady:
			projects.isReady &&
			folders.isReady &&
			workspacesReady &&
			placementsQuery.isSuccess,
		canMoveProject: (projectId: string) =>
			projects.projects.find((project) => project.id === projectId)
				?.supportsProjectTags === true &&
			projects.hostResults
				.filter((host) => host.rows?.some((row) => row.id === projectId))
				.every((host) => host.reachable && host.target.hostUrl !== null),
		mutate,
		hideEmptyCollections: preferences.hideEmptyProjectCollections,
		setHideEmptyCollections: setHideEmptyProjectCollections,
	};
}
