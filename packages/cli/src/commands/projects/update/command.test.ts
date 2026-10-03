import { afterEach, describe, expect, mock, test } from "bun:test";

const PROJECT_ID = "b502bf30-8693-4815-be65-795035e0ce5f";
const setTagsCalls: Array<{ projectId: string; tags: string[] }> = [];
const listCalls: Array<undefined> = [];

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
						setTagsCalls.push(input);
						return { id: input.projectId, tags: input.tags };
					},
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
});

describe("projects update", () => {
	test("sets the normalized collection tag", async () => {
		const result = (await update({ collection: " Dibsteur " })) as {
			data: { tags: string[] };
		};

		expect(setTagsCalls).toEqual([
			{ projectId: PROJECT_ID, tags: [" Dibsteur "] },
		]);
		expect(result.data.tags).toEqual([" Dibsteur "]);
	});

	test("clears the collection tag", async () => {
		await update({ clearCollection: true });

		expect(setTagsCalls).toEqual([{ projectId: PROJECT_ID, tags: [] }]);
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
	test("filters with the normalized collection name and returns tags", async () => {
		const result = (await list({ collection: " DIBSTEUR " })) as Array<{
			name: string;
			repo: string;
			path: string;
			tags: string[];
			id: string;
		}>;

		expect(result).toEqual([
			{
				name: "Superset",
				repo: "https://github.com/superset/superset",
				path: "/projects/superset",
				tags: ["dibsteur"],
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
