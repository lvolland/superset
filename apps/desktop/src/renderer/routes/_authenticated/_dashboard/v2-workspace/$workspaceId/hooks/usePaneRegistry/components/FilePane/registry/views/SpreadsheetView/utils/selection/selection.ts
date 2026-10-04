import type { CellPosition, CellRange } from "../../types";

/** The anchor is the active cell; the head is the corner a Shift move extends. */
export interface Selection {
	anchor: CellPosition;
	head: CellPosition;
}

export interface NavigationInput {
	key: string;
	shiftKey: boolean;
	/** Cmd on macOS, Ctrl elsewhere. */
	primaryKey: boolean;
}

export interface GridBounds {
	rows: number;
	cols: number;
}

export const ORIGIN: CellPosition = { row: 0, col: 0 };

export function collapsed(cell: CellPosition): Selection {
	return { anchor: cell, head: cell };
}

export function selectionRange({ anchor, head }: Selection): CellRange {
	return {
		top: Math.min(anchor.row, head.row),
		left: Math.min(anchor.col, head.col),
		bottom: Math.max(anchor.row, head.row),
		right: Math.max(anchor.col, head.col),
	};
}

export function clampSelection(
	selection: Selection,
	bounds: GridBounds,
): Selection {
	return {
		anchor: clampCell(selection.anchor, bounds),
		head: clampCell(selection.head, bounds),
	};
}

function clampCell(cell: CellPosition, { rows, cols }: GridBounds) {
	return {
		row: Math.max(0, Math.min(cell.row, rows - 1)),
		col: Math.max(0, Math.min(cell.col, cols - 1)),
	};
}

const ARROWS: Record<string, [number, number]> = {
	ArrowUp: [-1, 0],
	ArrowDown: [1, 0],
	ArrowLeft: [0, -1],
	ArrowRight: [0, 1],
};

/** Spreadsheet keyboard navigation. Returns null for keys it does not own. */
export function moveSelection(
	selection: Selection,
	input: NavigationInput,
	bounds: GridBounds,
	pageRows: number,
): Selection | null {
	const { key, shiftKey, primaryKey } = input;
	const lastRow = bounds.rows - 1;
	const lastCol = bounds.cols - 1;
	const from = shiftKey ? selection.head : selection.anchor;
	const place = (cell: CellPosition, extend: boolean): Selection => {
		const target = clampCell(cell, bounds);
		return extend
			? { anchor: selection.anchor, head: target }
			: collapsed(target);
	};

	const arrow = ARROWS[key];
	if (arrow) {
		const [dRow, dCol] = arrow;
		if (primaryKey) {
			return place(
				{
					row: dRow === 0 ? from.row : dRow < 0 ? 0 : lastRow,
					col: dCol === 0 ? from.col : dCol < 0 ? 0 : lastCol,
				},
				shiftKey,
			);
		}
		return place({ row: from.row + dRow, col: from.col + dCol }, shiftKey);
	}

	const active = selection.anchor;
	switch (key) {
		case "Tab":
			return place(
				{ row: active.row, col: active.col + (shiftKey ? -1 : 1) },
				false,
			);
		case "Enter":
			return place(
				{ row: active.row + (shiftKey ? -1 : 1), col: active.col },
				false,
			);
		case "PageDown":
			return place({ row: from.row + pageRows, col: from.col }, shiftKey);
		case "PageUp":
			return place({ row: from.row - pageRows, col: from.col }, shiftKey);
		case "Home":
			return place({ row: primaryKey ? 0 : from.row, col: 0 }, shiftKey);
		case "End":
			return primaryKey
				? place({ row: lastRow, col: lastCol }, shiftKey)
				: place({ row: from.row, col: lastCol }, shiftKey);
		default:
			return null;
	}
}
