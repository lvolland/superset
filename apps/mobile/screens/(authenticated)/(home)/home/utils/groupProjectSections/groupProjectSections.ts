import type { ProjectCollectionSummary } from "@superset/shared/project-collections";

export type GroupedProjectSection<Section> =
	| { kind: "project"; section: Section }
	| {
			kind: "collection";
			collection: ProjectCollectionSummary;
			sections: Section[];
	  };

/**
 * A collection takes the place of its first project in `sections`, and its
 * projects keep their relative order under it.
 */
export function groupProjectSections<Section extends { projectId: string }>(
	sections: readonly Section[],
	collectionByProjectId: ReadonlyMap<string, ProjectCollectionSummary>,
): GroupedProjectSection<Section>[] {
	const groups: GroupedProjectSection<Section>[] = [];
	const groupByTag = new Map<string, Section[]>();
	for (const section of sections) {
		const collection = collectionByProjectId.get(section.projectId);
		if (!collection) {
			groups.push({ kind: "project", section });
			continue;
		}
		const members = groupByTag.get(collection.tag);
		if (members) {
			members.push(section);
			continue;
		}
		const created = [section];
		groupByTag.set(collection.tag, created);
		groups.push({ kind: "collection", collection, sections: created });
	}
	return groups;
}
