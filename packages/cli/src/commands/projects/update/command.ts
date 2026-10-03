import { boolean, CLIError, positional, string } from "@superset/cli-framework";
import { getHostId } from "@superset/shared/host-info";
import { command } from "../../../lib/command";
import { resolveHostFilter, resolveHostTarget } from "../../../lib/host-target";

export default command({
	description: "Move a project into or out of a collection on a host",
	args: [positional("projectId").required().desc("Project UUID")],
	options: {
		host: string().desc("Host the project lives on (default: this machine)"),
		local: boolean().desc("The project is on this machine (the default)"),
		collection: string().desc("Collection name"),
		clearCollection: boolean().desc("Remove the project from its collection"),
	},
	run: async ({ ctx, args, options }) => {
		const organizationId = ctx.config.organizationId;
		if (!organizationId) {
			throw new CLIError("No active organization", "Run: superset auth login");
		}
		if (options.collection !== undefined && options.clearCollection) {
			throw new CLIError(
				"Cannot combine --collection and --clear-collection",
				"Pass one or the other",
			);
		}
		if (options.collection === undefined && !options.clearCollection) {
			throw new CLIError(
				"No collection change requested",
				"Pass --collection <name> or --clear-collection",
			);
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
		const projectId = args.projectId as string;
		const tags = options.clearCollection ? [] : [options.collection as string];
		const result = await target.client.project.setTags.mutate({
			projectId,
			tags,
		});

		return {
			data: result,
			message: options.clearCollection
				? `Removed project ${projectId} from its collection`
				: `Moved project ${projectId} to collection "${options.collection}"`,
		};
	},
});
