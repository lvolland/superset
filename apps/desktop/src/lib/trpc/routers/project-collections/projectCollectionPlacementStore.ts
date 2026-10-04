import {
	projectCollectionPendingDeletes,
	projectCollectionPlacements,
} from "@superset/local-db";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { LocalDb } from "main/lib/local-db";
import type {
	ProjectCollectionPendingDelete,
	ProjectCollectionPlacement,
} from "shared/project-collections";

export function projectCollectionPlacementStore(
	db: LocalDb,
	scope: { organizationId: string; userId: string },
) {
	const belongsToScope = () =>
		and(
			eq(projectCollectionPlacements.organizationId, scope.organizationId),
			eq(projectCollectionPlacements.userId, scope.userId),
		);
	const pendingScope = () =>
		and(
			eq(projectCollectionPendingDeletes.organizationId, scope.organizationId),
			eq(projectCollectionPendingDeletes.userId, scope.userId),
		);
	return {
		pendingDeletes: () =>
			db
				.select()
				.from(projectCollectionPendingDeletes)
				.where(pendingScope())
				.all(),
		acknowledgeDeletes: (rows: ProjectCollectionPendingDelete[]) =>
			db.transaction((tx) => {
				for (const row of rows)
					tx.delete(projectCollectionPendingDeletes)
						.where(
							and(
								pendingScope(),
								eq(projectCollectionPendingDeletes.machineId, row.machineId),
								eq(projectCollectionPendingDeletes.tag, row.tag),
							),
						)
						.run();
			}),
		list: () =>
			db
				.select()
				.from(projectCollectionPlacements)
				.where(belongsToScope())
				.all(),
		write: (
			rows: ProjectCollectionPlacement[],
			removeKeys: string[],
			pendingDeletes: ProjectCollectionPendingDelete[] = [],
			removePendingDeleteTags: string[] = [],
		) =>
			db.transaction((tx) => {
				if (removePendingDeleteTags.length)
					tx.delete(projectCollectionPendingDeletes)
						.where(
							and(
								pendingScope(),
								inArray(
									projectCollectionPendingDeletes.tag,
									removePendingDeleteTags,
								),
							),
						)
						.run();
				for (const row of pendingDeletes)
					tx.insert(projectCollectionPendingDeletes)
						.values({ ...scope, ...row })
						.onConflictDoNothing()
						.run();
				if (pendingDeletes.length) {
					const pending = tx
						.select()
						.from(projectCollectionPendingDeletes)
						.where(pendingScope())
						.all();
					const counts = new Map<string, number>();
					for (const row of pending) {
						const count = (counts.get(row.machineId) ?? 0) + 1;
						if (count > 128)
							throw new Error(
								"Too many pending collection deletions for this host",
							);
						counts.set(row.machineId, count);
					}
				}

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
