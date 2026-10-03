import { describe, expect, test } from "bun:test";
import { PROJECTS_TAG_SCOPE } from "@superset/shared/workspace-tags";
import { normalizeHostProjectRow } from "renderer/hooks/host-projects/useHostProjects/useHostProjects.utils";
import type { HostTagFolderSetting } from "renderer/hooks/host-projects/useHostTagFolders/useHostTagFolders.utils";
import {
	mutateProjectCollection,
	type ProjectCollectionMutationAdapter,
	type ProjectCollectionMutationState,
} from "./projectCollectionMutations";

function setup() {
	let state: ProjectCollectionMutationState = {
		projectHosts: ["local", "remote"].map((machineId) => ({
			target: {
				machineId,
				organizationId: "org",
				hostUrl: machineId,
				isLocal: machineId === "local",
			},
			reachable: true,
			rows: ["a", "b"].map((id) =>
				normalizeHostProjectRow({ id, repoPath: `/${id}`, tags: ["team"] }),
			),
		})),
		folderHosts: ["local", "remote"].map((machineId) => ({
			target: {
				machineId,
				organizationId: "org",
				hostUrl: machineId,
				isLocal: machineId === "local",
			},
			status: "ready",
			settings: [
				{
					scope: PROJECTS_TAG_SCOPE,
					tag: "team",
					displayName: "Team",
					color: "#ff0000",
					tabOrder: 1,
				},
				{
					scope: PROJECTS_TAG_SCOPE,
					tag: "other",
					displayName: "Other",
					color: null,
					tabOrder: 3,
				},
			],
		})),
		placements: [
			{ key: "root", kind: "project", tabOrder: 0, isCollapsed: false },
			{
				key: "projects:team",
				kind: "collection",
				tabOrder: 1,
				isCollapsed: true,
			},
			{ key: "a", kind: "project", tabOrder: 1, isCollapsed: false },
			{ key: "b", kind: "project", tabOrder: 0, isCollapsed: false },
		],
	};
	const tagCalls: Array<{
		url: string;
		updates: Array<{ projectId: string; tags: string[] }>;
	}> = [];
	const settingCalls: Array<{
		url: string;
		tag: string;
		setting: HostTagFolderSetting | null;
	}> = [];
	const placementCalls: Array<{
		rows: ProjectCollectionMutationState["placements"];
		removeKeys: string[];
	}> = [];
	let invalidations = 0;
	const adapter: ProjectCollectionMutationAdapter = {
		read: () => structuredClone(state),
		publish: (next) => {
			state = structuredClone(next);
		},
		setTags: async (url, updates) => {
			tagCalls.push({ url, updates });
		},
		setSetting: async (url, tag, setting) => {
			settingCalls.push({ url, tag, setting });
		},
		writePlacements: async (rows, removeKeys) => {
			placementCalls.push({ rows, removeKeys });
		},
		invalidate: () => {
			invalidations++;
		},
	};
	return {
		adapter,
		state: () => state,
		tagCalls,
		settingCalls,
		placementCalls,
		invalidations: () => invalidations,
	};
}

describe("project collection mutations", () => {
	test("moves several projects with one batched write per replica", async () => {
		const h = setup();
		expect(
			await mutateProjectCollection(h.adapter, {
				type: "move",
				projectIds: ["a", "b", "a"],
				tag: "other",
			}),
		).toBe(true);
		expect(h.tagCalls).toHaveLength(2);
		expect(h.tagCalls[0]?.updates).toEqual([
			{ projectId: "a", tags: ["other"] },
			{ projectId: "b", tags: ["other"] },
		]);
		expect(
			h
				.state()
				.projectHosts.every((host) =>
					host.rows?.every((row) => row.tags?.[0] === "other"),
				),
		).toBe(true);
		expect(h.placementCalls).toHaveLength(1);
	});
	test("moves to root with empty tags and inserts in mixed root order", async () => {
		const h = setup();
		await mutateProjectCollection(h.adapter, {
			type: "move",
			projectIds: ["b"],
			tag: null,
			index: 1,
		});
		expect(h.tagCalls[0]?.updates).toEqual([{ projectId: "b", tags: [] }]);
		expect(h.state().placements.find((row) => row.key === "b")?.tabOrder).toBe(
			1,
		);
		expect(
			h.state().placements.find((row) => row.key === "projects:team")?.tabOrder,
		).toBe(0);
	});
	test("creation propagates empty settings, then rename and color preserve membership", async () => {
		const h = setup();
		expect(
			await mutateProjectCollection(h.adapter, {
				type: "create",
				tag: " New ",
				name: "New collection",
			}),
		).toBe(true);
		expect(h.settingCalls).toHaveLength(2);
		expect(
			h.state().folderHosts[1]?.settings.find((row) => row.tag === "new")
				?.displayName,
		).toBe("New collection");
		await mutateProjectCollection(h.adapter, {
			type: "rename",
			tag: "new",
			name: "Renamed",
		});
		await mutateProjectCollection(h.adapter, {
			type: "color",
			tag: "new",
			color: "#abcdef",
		});
		expect(
			h.state().folderHosts[0]?.settings.find((row) => row.tag === "new"),
		).toMatchObject({ displayName: "Renamed", color: "#abcdef" });
		expect(h.tagCalls).toHaveLength(0);
	});
	test("creates and moves members as one transaction", async () => {
		const h = setup();
		await mutateProjectCollection(h.adapter, {
			type: "create",
			tag: "new",
			name: "New",
			projectIds: ["a", "b"],
		});
		expect(h.tagCalls).toHaveLength(2);
		expect(h.state().projectHosts[0]?.rows?.map((row) => row.tags)).toEqual([
			["new"],
			["new"],
		]);
	});
	test("deletion clears tags and expands members at collection position in manual order", async () => {
		const h = setup();
		await mutateProjectCollection(h.adapter, { type: "delete", tag: "team" });
		expect(h.state().placements.find((row) => row.key === "b")?.tabOrder).toBe(
			0,
		);
		expect(h.state().placements.find((row) => row.key === "a")?.tabOrder).toBe(
			1,
		);
		expect(
			h.state().placements.some((row) => row.key === "projects:team"),
		).toBe(false);
		expect(h.placementCalls[0]?.removeKeys).toEqual(["projects:team"]);
		expect(h.settingCalls.every((call) => call.setting === null)).toBe(true);
		expect(h.state().projectHosts[0]?.rows?.map((row) => row.tags)).toEqual([
			[],
			[],
		]);
	});
	test("local collapse and mixed reorder do not write host data", async () => {
		const h = setup();
		await mutateProjectCollection(h.adapter, {
			type: "collapse",
			tag: "team",
			isCollapsed: false,
		});
		await mutateProjectCollection(h.adapter, {
			type: "reorder",
			keys: ["projects:other", "projects:team"],
		});
		expect(
			h.state().placements.find((row) => row.key === "projects:team"),
		).toMatchObject({ isCollapsed: false, tabOrder: 1 });
		expect(h.tagCalls).toHaveLength(0);
		expect(h.settingCalls).toHaveLength(0);
	});
	test("old and offline replicas disable moves without calls", async () => {
		for (const old of [true, false]) {
			const h = setup();
			const prior = h.state();
			if (old && prior.projectHosts[1]?.rows?.[0])
				prior.projectHosts[1].rows[0].supportsProjectTags = false;
			else if (prior.projectHosts[1]) prior.projectHosts[1].reachable = false;
			expect(
				await mutateProjectCollection(h.adapter, {
					type: "move",
					projectIds: ["a"],
					tag: "other",
				}),
			).toBe(false);
			expect(h.tagCalls).toHaveLength(0);
		}
	});
	test("optimistic state precedes host write and failure compensates successful replicas", async () => {
		const h = setup();
		const before = structuredClone(h.state());
		h.adapter.setTags = async (url, updates) => {
			h.tagCalls.push({ url, updates });
			if (updates[0]?.tags[0] === "other") {
				expect(h.state().projectHosts[0]?.rows?.[0]?.tags).toEqual(["other"]);
				if (url === "remote") throw new Error("offline");
			}
		};
		await expect(
			mutateProjectCollection(h.adapter, {
				type: "move",
				projectIds: ["a"],
				tag: "other",
			}),
		).rejects.toThrow("offline");
		expect(h.state()).toEqual(before);
		expect(h.tagCalls.at(-1)).toEqual({
			url: "local",
			updates: [{ projectId: "a", tags: ["team"] }],
		});
		expect(h.invalidations()).toBe(1);
	});
	test("setting or SQLite failure restores tags, presentation and local placements", async () => {
		for (const failure of ["setting", "sqlite"]) {
			const h = setup();
			const before = structuredClone(h.state());
			if (failure === "setting")
				h.adapter.setSetting = async (url, tag, setting) => {
					h.settingCalls.push({ url, tag, setting });
					if (url === "remote" && setting === null) throw new Error(failure);
				};
			else
				h.adapter.writePlacements = async () => {
					throw new Error(failure);
				};
			await expect(
				mutateProjectCollection(h.adapter, { type: "delete", tag: "team" }),
			).rejects.toThrow(failure);
			expect(h.state()).toEqual(before);
			expect(
				h.tagCalls
					.slice(-2)
					.every((call) =>
						call.updates.every((update) => update.tags[0] === "team"),
					),
			).toBe(true);
		}
	});
	test("missing setTags silently rolls back and disables this project's actions", async () => {
		const h = setup();
		h.adapter.setTags = async () => {
			throw new Error('No procedure found on path "project.setTags"');
		};
		expect(
			await mutateProjectCollection(h.adapter, {
				type: "move",
				projectIds: ["a"],
				tag: "other",
			}),
		).toBe(false);
		expect(h.state().projectHosts[0]?.rows?.[0]).toMatchObject({
			tags: ["team"],
			supportsProjectTags: false,
		});
	});
});

test("delete preserves mixed root position, member order and projects in another collection", async () => {
	const h = setup();
	const state = h.state();
	for (const host of state.projectHosts) {
		host.rows?.push(
			normalizeHostProjectRow({ id: "root", repoPath: "/root", tags: [] }),
		);
		host.rows?.push(
			normalizeHostProjectRow({
				id: "secondary",
				repoPath: "/secondary",
				tags: ["team", "other"],
			}),
		);
	}
	for (const host of state.folderHosts) {
		const other = host.settings.find((row) => row.tag === "other");
		if (other) other.tabOrder = -1;
	}
	await mutateProjectCollection(h.adapter, { type: "delete", tag: "team" });
	expect(h.state().placements.find((row) => row.key === "root")?.tabOrder).toBe(
		1,
	);
	expect(h.state().placements.find((row) => row.key === "b")?.tabOrder).toBe(2);
	expect(h.state().placements.find((row) => row.key === "a")?.tabOrder).toBe(3);
	expect(
		h.state().projectHosts[0]?.rows?.find((row) => row.id === "secondary")
			?.tags,
	).toEqual(["other"]);
});
