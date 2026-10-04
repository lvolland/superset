import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { projectCollectionPlacements } from "@superset/local-db";
import { drizzle } from "drizzle-orm/bun-sqlite";
import type { LocalDb } from "main/lib/local-db";
import { projectCollectionPlacementStore } from "./projectCollectionPlacementStore";

const databases: Database[] = [];
afterEach(() => {
	for (const db of databases.splice(0)) db.close();
});
function setup() {
	const sqlite = new Database(":memory:");
	databases.push(sqlite);
	sqlite.run(
		readFileSync(
			resolve(
				import.meta.dir,
				"../../../../../../../packages/local-db/drizzle/0058_project_collection_placements.sql",
			),
			"utf8",
		),
	);
	const db = drizzle(sqlite, {
		schema: { projectCollectionPlacements },
	}) as unknown as LocalDb;
	return {
		sqlite,
		store: (organizationId = "org", userId = "alice") =>
			projectCollectionPlacementStore(db, { organizationId, userId }),
	};
}
const row = {
	key: "projects:team",
	kind: "collection" as const,
	tabOrder: 1,
	isCollapsed: true,
};

describe("SQLite project collection placements", () => {
	test("generated schema isolates organizations and users, upserts and deletes keys", () => {
		const h = setup();
		h.store().write([row], []);
		h.store("org", "bob").write([{ ...row, tabOrder: 3 }], []);
		h.store("other").write([{ ...row, tabOrder: 8 }], []);
		h.store().write([{ ...row, isCollapsed: false, tabOrder: 2 }], []);
		expect(h.store().list()).toEqual([
			{
				...row,
				tabOrder: 2,
				isCollapsed: false,
				organizationId: "org",
				userId: "alice",
			},
		]);
		h.store().write([], [row.key]);
		expect(h.store().list()).toEqual([]);
		expect(h.store("org", "bob").list()[0]?.tabOrder).toBe(3);
		expect(h.store("other").list()[0]?.tabOrder).toBe(8);
	});
	test("reconciliation prunes deleted projects and retired collections only in the current scope", () => {
		const h = setup();
		h.store().write(
			[
				row,
				{ key: "deleted", kind: "project", tabOrder: 0, isCollapsed: false },
			],
			[],
		);
		h.store("org", "bob").write([row], []);
		h.store().reconcile([row.key]);
		expect(
			h
				.store()
				.list()
				.map((item) => item.key),
		).toEqual([row.key]);
		h.store().reconcile([]);
		expect(h.store().list()).toEqual([]);
		expect(h.store("org", "bob").list()).toHaveLength(1);
	});
	test("a failed batch restores earlier updates and removals", () => {
		const h = setup();
		h.store().write([row], []);
		h.sqlite.run(
			"CREATE TRIGGER reject_bad BEFORE INSERT ON project_collection_placements WHEN NEW.key = 'bad' BEGIN SELECT RAISE(ABORT, 'bad key'); END",
		);
		expect(() =>
			h.store().write(
				[
					{ ...row, key: "new" },
					{ ...row, key: "bad" },
				],
				[row.key],
			),
		).toThrow("bad key");
		expect(
			h
				.store()
				.list()
				.map((item) => item.key),
		).toEqual([row.key]);
	});
});

test("placement store uses the public schema table identity", async () => {
	const { projectCollectionPlacements: publicTable } = await import(
		"@superset/local-db"
	);
	const h = setup();
	h.store().write([row], []);
	const db = drizzle(h.sqlite);
	expect(db.select().from(publicTable).all()[0]).toMatchObject(row);
});
