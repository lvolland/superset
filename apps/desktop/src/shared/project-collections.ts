import { z } from "zod";

export const projectCollectionPlacementSchema = z.object({
	key: z.string().min(1),
	kind: z.enum(["project", "collection"]),
	tabOrder: z.number().int(),
	isCollapsed: z.boolean(),
});

export type ProjectCollectionPlacement = z.infer<
	typeof projectCollectionPlacementSchema
>;

export const projectCollectionPlacementScopeSchema = z.object({
	organizationId: z.string().min(1),
	userId: z.string().min(1),
});

export const projectCollectionPendingDeleteSchema = z.object({
	machineId: z.string().min(1),
	tag: z.string().min(1),
});

export type ProjectCollectionPendingDelete = z.infer<
	typeof projectCollectionPendingDeleteSchema
>;
