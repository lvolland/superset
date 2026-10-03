import { LinearLookupError } from "@superset/trpc/linear-lookup";
import { z } from "zod";
import type { McpCaller } from "../../caller";

export const trackerInput = z
	.enum(["superset", "linear"])
	.nullish()
	.describe(
		"Work on Superset tasks or Linear issues. Omit to use the organization's task tracker setting.",
	);

export type TaskTracker = "superset" | "linear";

export async function resolveTracker(
	caller: McpCaller,
	requested: TaskTracker | null | undefined,
): Promise<TaskTracker> {
	if (requested) return requested;
	const organization = await caller.organization.getActive();
	return organization?.taskTracker ?? "superset";
}

export type ResolvedTask =
	| {
			tracker: "superset";
			task: NonNullable<Awaited<ReturnType<McpCaller["task"]["byIdOrSlug"]>>>;
	  }
	| { tracker: "linear"; issueId: string };

/**
 * A Superset id or slug wins, so the task linked to a workspace stays reachable
 * in an organization that tracks in Linear; anything else is a Linear
 * identifier there.
 */
export async function resolveTask(
	caller: McpCaller,
	idOrSlug: string,
	requested: TaskTracker | null | undefined,
): Promise<ResolvedTask> {
	if (requested !== "linear") {
		const task = await caller.task.byIdOrSlug(idOrSlug);
		if (task) return { tracker: "superset", task };
		if (requested === "superset")
			throw new Error(`Task not found: ${idOrSlug}`);
	}
	if ((await resolveTracker(caller, requested)) === "linear") {
		return { tracker: "linear", issueId: idOrSlug };
	}
	throw new Error(`Task not found: ${idOrSlug}`);
}

export function rejectUnsupported(fields: Record<string, unknown>) {
	const passed = Object.entries(fields)
		.filter(([, value]) => value != null && value !== false)
		.map(([name]) => name);
	if (passed.length > 0) {
		throw new Error(
			`Not supported for Linear issues: ${passed.join(", ")}. Pass tracker: "superset" to work on Superset tasks.`,
		);
	}
}

export function withLookupHint<T>(lookup: () => T): T {
	try {
		return lookup();
	} catch (error) {
		if (error instanceof LinearLookupError) {
			throw new Error(`${error.message}. ${error.hint}`);
		}
		throw error;
	}
}
