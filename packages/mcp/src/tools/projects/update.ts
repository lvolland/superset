import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { workspaceTagInputSchema } from "@superset/shared/workspace-tags";
import { z } from "zod";
import { defineTool } from "../../define-tool";
import { hostServiceCall } from "../../host-service-client";

export function register(server: McpServer): void {
	defineTool(server, {
		name: "projects_update",
		annotations: { destructiveHint: false, idempotentHint: true },
		description:
			"Move a project into a collection on a host, or remove it from its collection by passing collection: null. Use hosts_list and projects_list to resolve the hostId and project id.",
		inputSchema: {
			hostId: z
				.string()
				.min(1)
				.describe(
					"Host machineId where the project is set up. See hosts_list to enumerate accessible hosts.",
				),
			id: z.string().uuid().describe("Project UUID."),
			collection: workspaceTagInputSchema
				.nullable()
				.describe(
					"Collection name. Names are normalized to trimmed lowercase. Pass null to remove the project from its collection.",
				),
		},
		handler: async (input, ctx) => {
			return hostServiceCall(
				{
					relayUrl: ctx.relayUrl,
					organizationId: ctx.organizationId,
					hostId: input.hostId,
					jwt: ctx.bearerToken,
				},
				"project.setTags",
				"mutation",
				{
					projectId: input.id,
					tags: input.collection === null ? [] : [input.collection],
				},
			);
		},
	});
}
