import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { LocalDb } from "main/lib/local-db";
import type { ProjectCollectionPlacement } from "shared/project-collections";
import { projectCollectionPlacements } from "../../../../../../../packages/local-db/src/schema/schema";

export function projectCollectionPlacementStore(
	db: LocalDb,
	scope: { organizationId: string; userId: string },
) {
	const belongsToScope = () =>
		and(
			eq(projectCollectionPlacements.organizationId, scope.organizationId),
			eq(projectCollectionPlacements.userId, scope.userId),
		);
	return {
		list: () =>
			db
				.select()
				.from(projectCollectionPlacements)
				.where(belongsToScope())
				.all(),
		write: (rows: ProjectCollectionPlacement[], removeKeys: string[]) =>
			db.transaction((tx) => {
				if (removeKeys.length)
					tx.delete(projectCollectionPlacements)
						.where(
							and(
								belongsToScope(),
								inArray(projectCollectionPlacements.key, removeKeys),
							),
						)
						.run();
				for (const row of rows)
					tx.insert(projectCollectionPlacements)
						.values({ ...scope, ...row })
						.onConflictDoUpdate({
							target: [
								projectCollectionPlacements.organizationId,
								projectCollectionPlacements.userId,
								projectCollectionPlacements.key,
							],
							set: row,
						})
						.run();
			}),
		reconcile: (keys: string[]) =>
			db
				.delete(projectCollectionPlacements)
				.where(
					and(
						belongsToScope(),
						keys.length
							? notInArray(projectCollectionPlacements.key, keys)
							: undefined,
					),
				)
				.run(),
	};
}
