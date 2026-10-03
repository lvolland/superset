import { describe, expect, test } from "bun:test";
import {
	collectionDropId,
	PROJECT_COLLECTION_ROOT_DROP,
	type ProjectCollectionDragLayout,
	planProjectCollectionDrop,
} from "./projectCollectionDrop";

const layout: ProjectCollectionDragLayout = {
	rootKeys: ["root-a", "projects:team", "root-b", "projects:personal"],
	collections: [
		{ id: "projects:team", tag: "team", projectIds: ["a", "b", "c"] },
		{ id: "projects:personal", tag: "personal", projectIds: [] },
	],
};

describe("project collection drops", () => {
	test("reorders root projects and collections together", () => {
		expect(
			planProjectCollectionDrop(layout, "projects:team", "root-b"),
		).toEqual({
			type: "reorder",
			keys: ["root-a", "root-b", "projects:team", "projects:personal"],
		});
	});
	test("moves a root project onto a collection header", () => {
		expect(
			planProjectCollectionDrop(
				layout,
				"root-a",
				collectionDropId("projects:team"),
			),
		).toEqual({ type: "move", projectIds: ["root-a"], tag: "team", index: 3 });
		expect(
			planProjectCollectionDrop(layout, "root-a", "projects:team"),
		).toEqual({ type: "move", projectIds: ["root-a"], tag: "team", index: 3 });
	});
	test("moves into an empty collection", () => {
		expect(
			planProjectCollectionDrop(
				layout,
				"a",
				collectionDropId("projects:personal"),
			),
		).toEqual({ type: "move", projectIds: ["a"], tag: "personal", index: 0 });
	});
	test("inserts across collections at the hovered project", () => {
		const two = {
			...layout,
			collections: [
				...layout.collections,
				{ id: "projects:other", tag: "other", projectIds: ["d", "e"] },
			],
		};
		expect(planProjectCollectionDrop(two, "a", "e")).toEqual({
			type: "move",
			projectIds: ["a"],
			tag: "other",
			index: 1,
		});
	});
	test("reorders inside a collection", () => {
		expect(planProjectCollectionDrop(layout, "a", "c")).toEqual({
			type: "reorder",
			keys: ["b", "c", "a"],
		});
	});
	test("returns a member to a root position", () => {
		expect(planProjectCollectionDrop(layout, "a", "root-b")).toEqual({
			type: "move",
			projectIds: ["a"],
			tag: null,
			index: 2,
		});
	});
	test("returns a member to the end of the root", () => {
		expect(
			planProjectCollectionDrop(layout, "a", PROJECT_COLLECTION_ROOT_DROP),
		).toEqual({ type: "move", projectIds: ["a"], tag: null, index: 4 });
	});
	test("reorders a collection over a member of another collection", () => {
		const two = {
			...layout,
			collections: [
				{ id: "projects:team", tag: "team", projectIds: ["a", "b", "c"] },
				{ id: "projects:personal", tag: "personal", projectIds: ["d"] },
			],
		};
		expect(planProjectCollectionDrop(two, "projects:team", "d")).toEqual({
			type: "reorder",
			keys: ["root-a", "root-b", "projects:personal", "projects:team"],
		});
	});
	test("ignores unchanged and invalid targets", () => {
		expect(planProjectCollectionDrop(layout, "a", "a")).toBeNull();
		expect(planProjectCollectionDrop(layout, "a", "unrelated")).toBeNull();
		expect(
			planProjectCollectionDrop(
				layout,
				"projects:team",
				collectionDropId("projects:team"),
			),
		).toBeNull();
	});
});
