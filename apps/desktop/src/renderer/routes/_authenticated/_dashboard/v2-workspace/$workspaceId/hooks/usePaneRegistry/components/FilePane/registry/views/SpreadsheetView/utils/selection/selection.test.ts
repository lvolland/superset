import { describe, expect, test } from "bun:test";
import { collapsed, moveSelection, type Selection } from "./selection";

const bounds = { rows: 100, cols: 5 };
const at = (row: number, col: number) => collapsed({ row, col });
const press = (
	selection: Selection,
	key: string,
	modifiers: { shiftKey?: boolean; primaryKey?: boolean } = {},
) =>
	moveSelection(
		selection,
		{ key, shiftKey: false, primaryKey: false, ...modifiers },
		bounds,
		20,
	);

describe("moveSelection", () => {
	test("arrows move the active cell and stop at the grid edge", () => {
		expect(press(at(3, 2), "ArrowDown")).toEqual(at(4, 2));
		expect(press(at(0, 0), "ArrowUp")).toEqual(at(0, 0));
		expect(press(at(0, 4), "ArrowRight")).toEqual(at(0, 4));
	});

	test("Shift extends from the head and keeps the active cell", () => {
		const once = press(at(3, 2), "ArrowDown", { shiftKey: true });
		expect(once).toEqual({
			anchor: { row: 3, col: 2 },
			head: { row: 4, col: 2 },
		});
		expect(once && press(once, "ArrowRight", { shiftKey: true })).toEqual({
			anchor: { row: 3, col: 2 },
			head: { row: 4, col: 3 },
		});
	});

	test("Cmd+arrow jumps to the edge of the data, with Shift selecting up to it", () => {
		expect(press(at(3, 2), "ArrowDown", { primaryKey: true })).toEqual(
			at(99, 2),
		);
		expect(press(at(3, 2), "ArrowLeft", { primaryKey: true })).toEqual(
			at(3, 0),
		);
		expect(
			press(at(3, 2), "ArrowRight", { primaryKey: true, shiftKey: true }),
		).toEqual({ anchor: { row: 3, col: 2 }, head: { row: 3, col: 4 } });
	});

	test("Tab, Enter and paging collapse the selection around the active cell", () => {
		const range = { anchor: { row: 3, col: 2 }, head: { row: 6, col: 4 } };
		expect(press(range, "Tab")).toEqual(at(3, 3));
		expect(press(range, "Tab", { shiftKey: true })).toEqual(at(3, 1));
		expect(press(range, "Enter")).toEqual(at(4, 2));
		expect(press(range, "Enter", { shiftKey: true })).toEqual(at(2, 2));
		expect(press(at(90, 1), "PageDown")).toEqual(at(99, 1));
		expect(press(at(30, 1), "PageUp")).toEqual(at(10, 1));
		expect(press(at(30, 3), "Home", { primaryKey: true })).toEqual(at(0, 0));
		expect(press(at(30, 3), "End", { primaryKey: true })).toEqual(at(99, 4));
	});

	test("ignores keys it does not own", () => {
		expect(press(at(0, 0), "a")).toBeNull();
	});
});
