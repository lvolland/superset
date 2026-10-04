import { describe, expect, test } from "bun:test";
import type { ProjectCollectionPlacement } from "shared/project-collections";
import {
	derivePlacedProjectCollections,
	getProjectCollectionOrder,
	resolveProjectCollectionPlacements,
} from "./projectCollectionOrder";

const placement = (
	key: string,
	tabOrder: number,
): ProjectCollectionPlacement => ({
	key,
	kind: key.startsWith("projects:") ? "collection" : "project",
	tabOrder,
	isCollapsed: false,
});

describe("project collection order", () => {
	test("imports the legacy order once before local project placements exist", () => {
		expect(
			resolveProjectCollectionPlacements({
				projectIds: ["a", "b"],
				sidebarProjects: [
					{ projectId: "a", tabOrder: 8 },
					{ projectId: "b", tabOrder: 3 },
				],
				placements: [],
			}).map((row) => [row.key, row.tabOrder]),
		).toEqual([
			["b", 3],
			["a", 8],
		]);
	});

	for (const legacyOrder of [0, 4, 10]) {
		test(`prepends missing projects independently of legacy rank ${legacyOrder}`, () => {
			const view = derivePlacedProjectCollections({
				projects: ["a", "b", "new"].map((id) => ({ id, name: id })),
				hostResults: [],
				placements: [placement("a", 0), placement("b", 1)],
				sidebarProjects: [
					{ projectId: "new", tabOrder: legacyOrder, isHidden: false },
				],
			});
			expect(getProjectCollectionOrder(view.rootItems, [])).toEqual([
				"new",
				"a",
				"b",
			]);
		});
	}

	test("prepends new projects before collections with negative ranks", () => {
		const placements = resolveProjectCollectionPlacements({
			projectIds: ["new", "a"],
			sidebarProjects: [{ projectId: "new", tabOrder: 10 }],
			placements: [placement("projects:team", -5), placement("a", 0)],
		});
		expect(placements.find((row) => row.key === "new")?.tabOrder).toBe(-6);
	});

	test("a rail-only reorder does not migrate root projects onto the rail scale", () => {
		const resolved = resolveProjectCollectionPlacements({
			projectIds: ["a", "b"],
			sidebarProjects: [
				{ projectId: "a", tabOrder: 3 },
				{ projectId: "b", tabOrder: 9 },
			],
			placements: [placement("rail:b", 0), placement("rail:a", 1)],
		});
		expect(
			resolved
				.filter((row) => !row.key.startsWith("rail:"))
				.map((row) => [row.key, row.tabOrder]),
		).toEqual([
			["a", 3],
			["b", 9],
		]);
	});

	test("new rail projects precede persisted positions and hidden projects stay hidden", () => {
		const placements = [
			placement("a", 0),
			placement("hidden", 1),
			placement("b", 2),
			placement("rail:b", 0),
			placement("rail:a", 1),
			placement("rail:hidden", 2),
		];
		const view = derivePlacedProjectCollections({
			projects: ["a", "hidden", "b", "new"].map((id) => ({ id, name: id })),
			hostResults: [],
			placements,
			sidebarProjects: [{ projectId: "hidden", tabOrder: 0, isHidden: true }],
		});
		expect(getProjectCollectionOrder(view.rootItems, placements, true)).toEqual(
			["new", "b", "a"],
		);
		expect(getProjectCollectionOrder(view.rootItems, placements)).toEqual([
			"new",
			"a",
			"b",
		]);
	});
});
