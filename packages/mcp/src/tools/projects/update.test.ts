import { beforeEach, expect, mock, test } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Input = {
	hostId: string;
	id: string;
	collection: string | null;
};

let definition: {
	inputSchema: z.ZodRawShape;
	handler: (input: Input, ctx: object) => Promise<unknown>;
};
let request: { procedure: string; method: string; input: unknown } | undefined;

mock.module("../../define-tool", () => ({
	defineTool: (_server: unknown, value: typeof definition) => {
		definition = value;
	},
}));
mock.module("../../host-service-client", () => ({
	hostServiceCall: async (
		_context: unknown,
		procedure: string,
		method: string,
		input: unknown,
	) => {
		request = { procedure, method, input };
		return {};
	},
}));

const { register } = await import("./update");
register({} as McpServer);

const PROJECT_ID = "b502bf30-8693-4815-be65-795035e0ce5f";

beforeEach(() => {
	request = undefined;
});

test("moves a project into a normalized collection", async () => {
	const input = z.object(definition.inputSchema).parse({
		hostId: "host-1",
		id: PROJECT_ID,
		collection: " Dibsteur ",
	}) as Input;

	await definition.handler(input, {});

	expect(request).toEqual({
		procedure: "project.setTags",
		method: "mutation",
		input: { projectId: PROJECT_ID, tags: ["dibsteur"] },
	});
});

test("removes a project from its collection", async () => {
	const input = z.object(definition.inputSchema).parse({
		hostId: "host-1",
		id: PROJECT_ID,
		collection: null,
	}) as Input;

	await definition.handler(input, {});

	expect(request).toMatchObject({
		procedure: "project.setTags",
		method: "mutation",
		input: { projectId: PROJECT_ID, tags: [] },
	});
});
