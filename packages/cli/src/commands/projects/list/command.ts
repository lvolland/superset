import { boolean, CLIError, string, table } from "@superset/cli-framework";
import { getHostId } from "@superset/shared/host-info";
import { command } from "../../../lib/command";
import { resolveHostFilter, resolveHostTarget } from "../../../lib/host-target";
import {
	collectionDisplayName,
	isMissingProcedureError,
	projectCollectionsUnavailable,
	resolveProjectCollectionName,
	validateProjectCollectionName,
	type ProjectCollectionSetting,
} from "../collection";

export default command({
	description: "List projects on a host (default: this machine)",
	display: (data) =>
		table(
			data as Record<string, unknown>[],
			["name", "repo", "path", "collection", "tags", "id"],
			["NAME", "REPO", "PATH", "COLLECTION", "TAGS", "ID"],
		),
	options: {
		host: string().desc("List projects on a specific host machineId"),
		local: boolean().desc("List projects on this machine (the default)"),
		collection: string().desc("Filter to projects in this collection"),
	},
	run: async ({ ctx, options }) => {
		const organizationId = ctx.config.organizationId;
		if (!organizationId) {
			throw new CLIError("No active organization", "Run: superset auth login");
		}

		if (options.collection !== undefined) {
			validateProjectCollectionName(options.collection);
		}
		const hostId =
			resolveHostFilter({
				host: options.host ?? undefined,
				local: options.local ?? undefined,
			}) ?? getHostId();

		const target = await resolveHostTarget({
			requestedHostId: hostId,
			organizationId,
			userJwt: ctx.bearer,
			api: ctx.api,
		});
		let settings: ProjectCollectionSetting[];
		try {
			settings = (await target.client.tagFolders.list.query()) as ProjectCollectionSetting[];
		} catch (error) {
			if (isMissingProcedureError(error)) throw projectCollectionsUnavailable();
			throw error;
		}
		const collection =
			options.collection === undefined
				? null
				: resolveProjectCollectionName(options.collection, settings);
		const projects = await target.client.project.list.query();

		return projects
			.filter(
				(project) =>
					collection == null || (project.tags ?? []).includes(collection),
			)
			.map((project) => ({
				name: project.name,
				repo: project.repoUrl ?? "-",
				path: project.repoPath,
				collection: collectionDisplayName(project.tags ?? [], settings),
				tags: project.tags ?? [],
				id: project.id,
			}))
			.sort((a, b) => a.name.localeCompare(b.name));
	},
});
