import { localDb } from "main/lib/local-db";
import {
	projectCollectionPendingDeleteSchema,
	projectCollectionPlacementSchema,
	projectCollectionPlacementScopeSchema,
} from "shared/project-collections";
import { z } from "zod";
import { publicProcedure, router } from "../..";
import { projectCollectionPlacementStore } from "./projectCollectionPlacementStore";

export const createProjectCollectionsRouter = () =>
	router({
		list: publicProcedure
			.input(projectCollectionPlacementScopeSchema)
			.query(({ input }) =>
				projectCollectionPlacementStore(localDb, input).list(),
			),
		pendingDeletes: publicProcedure
			.input(projectCollectionPlacementScopeSchema)
			.query(({ input }) =>
				projectCollectionPlacementStore(localDb, input).pendingDeletes(),
			),
		acknowledgeDeletes: publicProcedure
			.input(
				projectCollectionPlacementScopeSchema.extend({
					rows: z.array(projectCollectionPendingDeleteSchema),
				}),
			)
			.mutation(({ input }) =>
				projectCollectionPlacementStore(localDb, input).acknowledgeDeletes(
					input.rows,
				),
			),
		write: publicProcedure
			.input(
				projectCollectionPlacementScopeSchema.extend({
					rows: z.array(projectCollectionPlacementSchema),
					removeKeys: z.array(z.string()).default([]),
					pendingDeletes: z
						.array(projectCollectionPendingDeleteSchema)
						.optional(),
					removePendingDeleteTags: z.array(z.string()).optional(),
				}),
			)
			.mutation(({ input }) => {
				projectCollectionPlacementStore(localDb, input).write(
					input.rows,
					input.removeKeys,
					input.pendingDeletes,
					input.removePendingDeleteTags,
				);
			}),
		reconcile: publicProcedure
			.input(
				projectCollectionPlacementScopeSchema.extend({
					keys: z.array(z.string()),
				}),
			)
			.mutation(({ input }) => {
				projectCollectionPlacementStore(localDb, input).reconcile(input.keys);
			}),
	});
