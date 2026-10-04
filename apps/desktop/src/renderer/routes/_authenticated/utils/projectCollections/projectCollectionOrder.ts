import type { ProjectCollectionPlacement } from "shared/project-collections";
import {
	type CollectionProject,
	deriveProjectCollections,
	type ProjectCollectionRootItem,
} from "./projectCollections";

export const projectRailPlacementKey = (projectId: string) =>
	`rail:${projectId}`;

export function resolveProjectCollectionPlacements({
	projectIds,
	sidebarProjects,
	placements,
}: {
	projectIds: string[];
	sidebarProjects: ReadonlyArray<{ projectId: string; tabOrder: number }>;
	placements: readonly ProjectCollectionPlacement[];
}): ProjectCollectionPlacement[] {
	const stored = new Set(
		placements.filter((row) => row.kind === "project").map((row) => row.key),
	);
	const legacyOrder = new Map(
		sidebarProjects.map((row) => [row.projectId, row.tabOrder]),
	);
	const missing = projectIds
		.filter((id) => !stored.has(id))
		.sort(
			(a, b) =>
				(legacyOrder.get(a) ?? 0) - (legacyOrder.get(b) ?? 0) ||
				a.localeCompare(b),
		);
	const hasProjectOrder = placements.some(
		(row) => !row.key.startsWith("rail:"),
	);
	const first = Math.min(
		0,
		...placements
			.filter((row) => !row.key.startsWith("rail:"))
			.map((row) => row.tabOrder),
	);
	return [
		...placements,
		...missing.map((key, index) => ({
			key,
			kind: "project" as const,
			tabOrder: hasProjectOrder
				? first - missing.length + index
				: (legacyOrder.get(key) ?? 0),
			isCollapsed: false,
		})),
	];
}

export function getProjectCollectionOrder<Project extends { id: string }>(
	items: readonly ProjectCollectionRootItem<Project>[],
	placements: readonly ProjectCollectionPlacement[],
	isRail = false,
): string[] {
	const keys = items.flatMap((item) =>
		item.type === "project"
			? [item.project.id]
			: item.collection.projects.map((project) => project.id),
	);
	if (!isRail) return keys;
	const order = new Map(
		placements
			.filter((row) => row.key.startsWith("rail:"))
			.map((row) => [row.key.slice("rail:".length), row.tabOrder]),
	);
	if (!order.size) return keys;
	const fallback = new Map(keys.map((key, index) => [key, index]));
	return keys.sort((a, b) => {
		const aOrder = order.get(a);
		const bOrder = order.get(b);
		if (aOrder === undefined && bOrder === undefined)
			return (fallback.get(a) ?? 0) - (fallback.get(b) ?? 0);
		if (aOrder === undefined) return -1;
		if (bOrder === undefined) return 1;
		return aOrder - bOrder || (fallback.get(a) ?? 0) - (fallback.get(b) ?? 0);
	});
}

export function derivePlacedProjectCollections<
	Project extends CollectionProject,
>(
	input: Omit<
		Parameters<typeof deriveProjectCollections<Project>>[0],
		"placements" | "projectPlacements"
	> & {
		placements: readonly ProjectCollectionPlacement[];
		sidebarProjects: ReadonlyArray<{
			projectId: string;
			tabOrder: number;
			isHidden: boolean;
		}>;
	},
) {
	const resolved = resolveProjectCollectionPlacements({
		projectIds: input.projects.map((project) => project.id),
		sidebarProjects: input.sidebarProjects,
		placements: input.placements,
	});
	const hidden = new Map(
		input.sidebarProjects.map((row) => [row.projectId, row.isHidden]),
	);
	return deriveProjectCollections({
		...input,
		placements: input.placements
			.filter((row) => row.kind === "collection")
			.map((row) => ({
				sectionId: row.key,
				projectId: "projects",
				tag: row.key.slice("projects:".length),
				name: row.key,
				createdAt: new Date(0),
				color: null,
				tabOrder: row.tabOrder,
				isCollapsed: row.isCollapsed,
			})),
		projectPlacements: resolved
			.filter((row) => row.kind === "project" && !row.key.startsWith("rail:"))
			.map((row) => ({
				projectId: row.key,
				isHidden: hidden.get(row.key) ?? false,
				tabOrder: row.tabOrder,
			})),
	});
}
