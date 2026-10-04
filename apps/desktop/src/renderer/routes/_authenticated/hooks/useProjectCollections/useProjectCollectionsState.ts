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
import type {
	ProjectCollectionPendingDelete,
	ProjectCollectionPlacement,
} from "shared/project-collections";
import {
	derivePlacedProjectCollections,
	getProjectCollectionOrder,
	projectRailPlacementKey,
	resolveProjectCollectionPlacements,
} from "../../utils/projectCollections/projectCollectionOrder";
import {
	enqueueProjectCollectionMutation,
	mutateProjectCollection,
	type ProjectCollectionCommand,
	type ProjectCollectionMutationState,
} from "./projectCollectionMutations";
import {
	replayProjectCollectionDeletes,
	withoutPendingProjectCollections,
} from "./replayProjectCollectionDeletes";

const EMPTY_PENDING_DELETES: ProjectCollectionPendingDelete[] = [];

export function useProjectCollectionsState() {
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
	const pendingQuery = electronTrpc.projectCollections.pendingDeletes.useQuery(
		scope,
		{
			enabled,
			refetchInterval: 60_000,
		},
	);
	const acknowledge =
		electronTrpc.projectCollections.acknowledgeDeletes.useMutation();
	const pendingDeletes = pendingQuery.data ?? EMPTY_PENDING_DELETES;
	const folderHosts = useMemo(
		() => withoutPendingProjectCollections(folders.hostResults, pendingDeletes),
		[folders.hostResults, pendingDeletes],
	);
	const write = electronTrpc.projectCollections.write.useMutation();
	const reconcile = electronTrpc.projectCollections.reconcile.useMutation();
	const utils = electronTrpc.useUtils();
	const queryClient = useQueryClient();
	const placements: ProjectCollectionPlacement[] = placementsQuery.data ?? [];
	const current = useRef<ProjectCollectionMutationState>({
		projectHosts: projects.hostResults,
		folderHosts,
		placements,
	});
	current.current = {
		projectHosts: projects.hostResults,
		folderHosts,
		placements,
	};
	const view = useMemo(
		() =>
			derivePlacedProjectCollections({
				projects: projects.projects,
				hostResults: folderHosts,
				placements,
				sidebarProjects,
				workspaces,
				sortMode: preferences.sidebarProjectSortMode,
				hideEmpty: preferences.hideEmptyProjectCollections,
			}),
		[
			projects.projects,
			folderHosts,
			placements,
			sidebarProjects,
			workspaces,
			preferences.sidebarProjectSortMode,
			preferences.hideEmptyProjectCollections,
		],
	);
	const replayKey = JSON.stringify([
		scopeKey,
		pendingQuery.dataUpdatedAt,
		pendingDeletes.map(({ machineId, tag }) => [machineId, tag]),
		folders.hostResults.map(({ target, status }) => [
			target.machineId,
			target.hostUrl,
			status,
		]),
	]);
	const lastReplay = useRef("");
	useEffect(() => {
		if (
			!enabled ||
			!pendingQuery.isSuccess ||
			!pendingDeletes.length ||
			lastReplay.current === replayKey
		)
			return;
		lastReplay.current = replayKey;
		void enqueueProjectCollectionMutation(scopeKey, async () => {
			await replayProjectCollectionDeletes({
				hosts: folders.hostResults,
				pending: utils.projectCollections.pendingDeletes.getData(scope) ?? [],
				remove: (url, tag) =>
					getHostServiceClientByUrl(url).tagFolders.delete.mutate({
						scope: PROJECTS_TAG_SCOPE,
						tag,
					}),
				acknowledge: async (row) => {
					const queryKey = [
						"host-tag-folders",
						scope.organizationId,
						row.machineId,
					];
					queryClient.setQueryData<HostTagFolderSetting[]>(
						queryKey,
						(settings) =>
							settings?.filter(
								(setting) =>
									setting.scope !== PROJECTS_TAG_SCOPE ||
									setting.tag !== row.tag,
							),
					);
					await queryClient.invalidateQueries({
						queryKey: ["host-tag-folders", scope.organizationId, row.machineId],
					});
					await acknowledge.mutateAsync({ ...scope, rows: [row] });
					await utils.projectCollections.pendingDeletes.invalidate(scope);
				},
			});
		}).catch(() => undefined);
	}, [
		enabled,
		pendingQuery.isSuccess,
		pendingDeletes,
		replayKey,
		folders.hostResults,
		scopeKey,
		scope,
		utils,
		queryClient,
		acknowledge,
	]);
	const knownKeys = [
		...projects.projects.map((project) => project.id),
		...view.collections.map((collection) => collection.id),
	]
		.sort()
		.join("\u0000");
	const canReconcile =
		enabled &&
		pendingQuery.isSuccess &&
		projects.isReady &&
		folders.isReady &&
		projects.hostResults.every((host) => host.reachable) &&
		folders.hostResults.every((host) => host.status === "ready");
	const lastReconciled = useRef("");
	useEffect(() => {
		const identity = `${scope.organizationId}\u0000${scope.userId}\u0000${knownKeys}`;
		if (!canReconcile || lastReconciled.current === identity) return;
		lastReconciled.current = identity;
		void enqueueProjectCollectionMutation(scopeKey, async () => {
			await reconcile.mutateAsync({
				...scope,
				keys: [
					...new Set([
						...current.current.projectHosts.flatMap((host) =>
							(host.rows ?? []).flatMap((row) => [
								row.id,
								projectRailPlacementKey(row.id),
							]),
						),
						...current.current.projectHosts.flatMap((host) =>
							(host.rows ?? []).flatMap((row) =>
								(row.tags ?? []).map((tag) => `${PROJECTS_TAG_SCOPE}:${tag}`),
							),
						),
						...current.current.folderHosts.flatMap((host) =>
							host.settings
								.filter((row) => row.scope === PROJECTS_TAG_SCOPE)
								.map((row) => `${PROJECTS_TAG_SCOPE}:${row.tag}`),
						),
					]),
				],
			});
			await utils.projectCollections.list.invalidate(scope);
		}).catch(() => {
			lastReconciled.current = "";
		});
	}, [canReconcile, knownKeys, scope, scopeKey, reconcile, utils]);
	const mutate = useCallback(
		async (command: ProjectCollectionCommand) => {
			if (!enabled || !placementsQuery.isSuccess || !pendingQuery.isSuccess)
				return false;
			return enqueueProjectCollectionMutation(scopeKey, async () => {
				const localOnly =
					command.type === "collapse" || command.type === "reorder";

				await Promise.all([
					...(localOnly ? [] : current.current.projectHosts).map((host) =>
						queryClient.cancelQueries({
							queryKey: getHostProjectsQueryKey(host.target),
						}),
					),
					...(localOnly ? [] : current.current.folderHosts).map((host) =>
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
				const baseline: ProjectCollectionMutationState = {
					projectHosts: current.current.projectHosts.map((host) => ({
						...host,
						rows:
							queryClient.getQueryData<HostProjectRow[]>(
								getHostProjectsQueryKey(host.target),
							) ?? host.rows,
					})),
					folderHosts: withoutPendingProjectCollections(
						current.current.folderHosts.map((host) => ({
							...host,
							settings:
								queryClient.getQueryData<HostTagFolderSetting[]>([
									"host-tag-folders",
									host.target.organizationId,
									host.target.machineId,
								]) ?? host.settings,
						})),
						utils.projectCollections.pendingDeletes.getData(scope) ?? [],
					),
					placements:
						utils.projectCollections.list.getData(scope) ??
						current.current.placements,
				};
				return await mutateProjectCollection(
					{
						read: () => ({
							...baseline,
							placements: resolveProjectCollectionPlacements({
								projectIds: [
									...new Set(
										baseline.projectHosts.flatMap((host) =>
											(host.rows ?? []).map((row) => row.id),
										),
									),
								],
								sidebarProjects,
								placements: baseline.placements,
							}),
						}),
						publish: (state) => {
							current.current = state;
							for (const host of localOnly ? [] : state.projectHosts)
								queryClient.setQueryData<HostProjectRow[]>(
									getHostProjectsQueryKey(host.target),
									host.rows,
								);
							for (const host of localOnly ? [] : state.folderHosts)
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
						writePlacements: async (
							rows,
							removeKeys,
							pendingDeletes,
							removePendingDeleteTags,
						) => {
							await write.mutateAsync({
								...scope,
								rows,
								removeKeys,
								pendingDeletes,
								removePendingDeleteTags,
							});
							if (!pendingDeletes?.length && !removePendingDeleteTags?.length)
								return;
							const previous =
								utils.projectCollections.pendingDeletes.getData(scope) ?? [];
							utils.projectCollections.pendingDeletes.setData(scope, [
								...previous.filter(
									(row) =>
										!removePendingDeleteTags?.includes(row.tag) &&
										!pendingDeletes?.some(
											(added) =>
												added.machineId === row.machineId &&
												added.tag === row.tag,
										),
								),
								...(pendingDeletes ?? []).map((row) => ({ ...scope, ...row })),
							]);
							await utils.projectCollections.pendingDeletes
								.invalidate(scope)
								.catch(() => undefined);
						},
						invalidate: async () => {
							const refreshes: Promise<unknown>[] = [];
							for (const host of command.type === "move" ||
							command.type === "delete" ||
							(command.type === "create" && command.projectIds?.length) ||
							(command.type === "rename" && command.replacementTag)
								? baseline.projectHosts
								: [])
								refreshes.push(
									queryClient.invalidateQueries({
										queryKey: getHostProjectsQueryKey(host.target),
									}),
								);
							for (const host of command.type === "move"
								? []
								: baseline.folderHosts)
								refreshes.push(
									queryClient.invalidateQueries({
										queryKey: [
											"host-tag-folders",
											host.target.organizationId,
											host.target.machineId,
										],
									}),
								);
							refreshes.push(utils.projectCollections.list.invalidate(scope));
							await Promise.allSettled(refreshes);
						},
					},
					command,
				);
			});
		},
		[
			enabled,
			placementsQuery.isSuccess,
			pendingQuery.isSuccess,
			scope,
			scopeKey,
			queryClient,
			utils,
			write,
			sidebarProjects,
		],
	);
	const projectOrder = useMemo(
		() => getProjectCollectionOrder(view.rootItems, placements),
		[view.rootItems, placements],
	);
	const railProjectOrder = useMemo(
		() => getProjectCollectionOrder(view.rootItems, placements, true),
		[view.rootItems, placements],
	);
	return {
		...view,
		projectOrder,
		railProjectOrder,
		isReady:
			projects.isReady &&
			folders.isReady &&
			workspacesReady &&
			placementsQuery.isSuccess &&
			pendingQuery.isSuccess,
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
