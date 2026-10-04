import { afterEach, describe, expect, mock, test } from "bun:test";

const PROJECT_ID = "b502bf30-8693-4815-be65-795035e0ce5f";
const setTagsCalls: Array<{ projectId: string; tags: string[] }> = [];
const listCalls: Array<undefined> = [];
let missingProcedure: string | undefined;

const projects = [
	{
		id: PROJECT_ID,
		name: "Superset",
		repoUrl: "https://github.com/superset/superset",
		repoPath: "/projects/superset",
		tags: ["dibsteur"],
	},
	{
		id: "d625bf30-8693-4815-be65-795035e0ce5f",
		name: "Roger",
		repoUrl: null,
		repoPath: "/projects/roger",
		tags: ["personal"],
	},
];

mock.module("../../../lib/host-target", () => ({
	resolveHostFilter: ({ host }: { host?: string }) => host,
	resolveHostTarget: async () => ({
		hostId: "host-1",
		client: {
			project: {
				list: {
					query: async () => {
						listCalls.push(undefined);
						return projects;
					},
				},
				setTags: {
					mutate: async (input: { projectId: string; tags: string[] }) => {
						if (missingProcedure === "project.setTags") {
							throw new Error("No procedure found on path project.setTags");
						}
						setTagsCalls.push(input);
						return { id: input.projectId, tags: input.tags };
					},
				},
			},
			tagFolders: {
				list: {
					query: async () => [
						{
							scope: "projects",
							tag: "dibsteur",
							displayName: "Client work",
						},
					],
				},
			},
		},
	}),
}));

const { default: listCommand } = await import("../list/command");
const { default: updateCommand } = await import("./command");

function context() {
	return {
		api: {},
		config: { organizationId: "org-1" },
		bearer: "token",
		authSource: "oauth",
	} as never;
}

function update(options: Record<string, unknown>) {
	return updateCommand.run({
		ctx: context(),
		args: { projectId: PROJECT_ID } as never,
		options: { host: "host-1", ...options } as never,
		signal: new AbortController().signal,
	});
}

function list(options: Record<string, unknown>) {
	return listCommand.run({
		ctx: context(),
		args: {} as never,
		options: { host: "host-1", ...options } as never,
		signal: new AbortController().signal,
	});
}

afterEach(() => {
	setTagsCalls.length = 0;
	listCalls.length = 0;
	missingProcedure = undefined;
});

describe("projects update", () => {
	test("resolves a collection display name before setting its tag", async () => {
		const result = (await update({ collection: " CLIENT WORK " })) as {
			data: { tags: string[] };
		};

		expect(setTagsCalls).toEqual([{ projectId: PROJECT_ID, tags: ["dibsteur"] }]);
		expect(result.data.tags).toEqual(["dibsteur"]);
	});

	test("clears the collection tag", async () => {
		await update({ clearCollection: true });

		expect(setTagsCalls).toEqual([{ projectId: PROJECT_ID, tags: [] }]);
	});

	test("rejects an empty collection before calling the host", async () => {
		await expect(update({ collection: "   " })).rejects.toThrow(
			"Invalid --collection value",
		);
		expect(setTagsCalls).toEqual([]);
	});

	test("explains when the host does not support project collections", async () => {
		missingProcedure = "project.setTags";

		await expect(update({ collection: "Client work" })).rejects.toThrow(
			"does not support project collections",
		);
	});

	test("rejects conflicting collection options before calling the host", async () => {
		await expect(
			update({ collection: "dibsteur", clearCollection: true }),
		).rejects.toThrow(/Cannot combine/);
		expect(setTagsCalls).toEqual([]);
	});

	test("requires a collection change", async () => {
		await expect(update({})).rejects.toThrow(/No collection change/);
		expect(setTagsCalls).toEqual([]);
	});
});

describe("projects list", () => {
	test("resolves display names when filtering and includes the collection name", async () => {
		const result = (await list({ collection: " CLIENT WORK " })) as Array<{
			name: string;
			repo: string;
			path: string;
			tags: string[];
			collection: string | null;
			id: string;
		}>;

		expect(result).toEqual([
			{
				name: "Superset",
				repo: "https://github.com/superset/superset",
				path: "/projects/superset",
				tags: ["dibsteur"],
				collection: "Client work",
				id: PROJECT_ID,
			},
		]);
	});

	test("rejects an invalid collection before requesting projects", async () => {
		await expect(list({ collection: "   " })).rejects.toThrow(
			/Invalid --collection/,
		);
		expect(listCalls).toEqual([]);
	});
});
