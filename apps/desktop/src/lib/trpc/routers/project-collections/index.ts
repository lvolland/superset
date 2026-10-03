import { localDb } from "main/lib/local-db";
import {
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
		write: publicProcedure
			.input(
				projectCollectionPlacementScopeSchema.extend({
					rows: z.array(projectCollectionPlacementSchema),
					removeKeys: z.array(z.string()).default([]),
				}),
			)
			.mutation(({ input }) => {
				projectCollectionPlacementStore(localDb, input).write(
					input.rows,
					input.removeKeys,
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
