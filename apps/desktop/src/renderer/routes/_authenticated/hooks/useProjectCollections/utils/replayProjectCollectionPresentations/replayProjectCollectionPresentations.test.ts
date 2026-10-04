import { expect, test } from "bun:test";
import type { HostTagFoldersResult } from "renderer/hooks/host-projects/useHostTagFolders/useHostTagFolders.utils";
import type { ProjectCollectionPendingPresentation } from "shared/project-collections";
import { enqueueProjectCollectionMutation } from "../../projectCollectionMutations";
import { replayProjectCollectionPresentations } from "./replayProjectCollectionPresentations";

const hosts: HostTagFoldersResult[] = [
	"old",
	"failing",
	"ready",
	"offline",
].map((machineId) => ({
	target: {
		machineId,
		organizationId: "org",
		hostUrl: machineId,
		isLocal: false,
	},
	status: machineId === "offline" ? "offline" : "ready",
	settings: [],
}));
const entry = (
	machineId: string,
	tag = "team",
): ProjectCollectionPendingPresentation => ({
	machineId,
	tag,
	setting: {
		scope: "projects",
		tag,
		displayName: "New",
		color: null,
		tabOrder: 0,
	},
});

test("unsupported and transient hosts do not starve later hosts", async () => {
	let pending = [
		entry("old"),
		entry("old", "second"),
		entry("failing"),
		entry("failing", "second"),
		entry("ready"),
		entry("ready", "second"),
		entry("offline"),
	];
	const calls: string[] = [];
	const invalidations: string[] = [];
	await replayProjectCollectionPresentations({
		hosts,
		pending,
		readPending: () => pending,
		enqueue: (work) => enqueueProjectCollectionMutation("replay", work),
		upsert: async (host) => {
			calls.push(host.target.machineId);
			if (host.target.machineId === "old")
				throw { data: { code: "BAD_REQUEST" } };
			if (host.target.machineId === "failing") throw new Error("Disconnected");
		},
		acknowledge: async (row) => {
			pending = pending.filter((entry) => entry !== row);
		},
		invalidate: (host) => {
			invalidations.push(host.target.machineId);
		},
	});
	expect(calls).toEqual(["old", "failing", "ready", "ready"]);
	expect(pending.map((row) => row.machineId)).toEqual([
		"failing",
		"failing",
		"offline",
	]);
	expect(invalidations).toEqual(["ready"]);
});

test("one replay write yields to user mutations and skips superseded entries", async () => {
	const first = entry("ready");
	const second = entry("ready", "second");
	let pending = [first, second];
	const calls: string[] = [];
	let release!: () => void;
	let started!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const writing = new Promise<void>((resolve) => {
		started = resolve;
	});
	const replay = replayProjectCollectionPresentations({
		hosts,
		pending,
		readPending: () => pending,
		enqueue: (work) => enqueueProjectCollectionMutation("yield", work),
		upsert: async (_host, row) => {
			calls.push(row.tag);
			started();
			await gate;
		},
		acknowledge: async (row) => {
			pending = pending.filter((entry) => entry !== row);
		},
		invalidate: () => {},
	});
	await writing;
	const user = enqueueProjectCollectionMutation("yield", async () => {
		calls.push("user");
		pending = [];
	});
	release();
	await Promise.all([replay, user]);
	expect(calls).toEqual(["team", "user"]);
});

for (const error of [
	new Error('No procedure found on path "tagFolders.upsert"'),
	{ data: { code: "BAD_REQUEST" }, message: "scope must be sessions or uuid" },
]) {
	test("definitive presentation refusals are acknowledged", async () => {
		const pending = [entry("old")];
		const acknowledged: ProjectCollectionPendingPresentation[] = [];
		await replayProjectCollectionPresentations({
			hosts,
			pending,
			readPending: () => pending,
			enqueue: (work) => work(),
			upsert: async () => {
				throw error;
			},
			acknowledge: async (row) => {
				acknowledged.push(row);
			},
			invalidate: () => {
				throw new Error("No successful write");
			},
		});
		expect(acknowledged).toEqual(pending);
	});
}

test("a missing router on an error host discards the author presentation", async () => {
	const host = hosts[0];
	if (!host) throw new Error("Missing host");
	const pending = [entry(host.target.machineId)];
	let acknowledged = false;
	await replayProjectCollectionPresentations({
		hosts: [{ ...host, status: "error" }],
		pending,
		readPending: () => pending,
		enqueue: (work) => work(),
		upsert: async () => {
			throw new Error("No procedure found on path tagFolders.upsert");
		},
		acknowledge: async () => {
			acknowledged = true;
		},
		invalidate: () => {},
	});
	expect(acknowledged).toBe(true);
});
