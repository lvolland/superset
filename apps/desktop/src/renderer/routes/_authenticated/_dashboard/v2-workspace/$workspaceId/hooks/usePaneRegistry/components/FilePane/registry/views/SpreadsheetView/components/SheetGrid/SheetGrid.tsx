import { cn } from "@superset/ui/utils";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
	type KeyboardEvent,
	type PointerEvent,
	type Ref,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
} from "react";
import { PLATFORM } from "renderer/hotkeys";
import type {
	CellPosition,
	CellRange,
	GridCell,
	SheetSummary,
} from "../../types";
import {
	columnAtOffset,
	columnStarts,
	gutterWidth,
	HEADER_HEIGHT,
	ROW_HEIGHT,
	revealOffset,
} from "../../utils/gridGeometry";
import {
	moveSelection,
	type Selection,
	selectionRange,
} from "../../utils/selection";
import { ColumnHeader } from "./components/ColumnHeader";
import { type MatchState, SheetCell } from "./components/SheetCell";
import {
	HEADER_SURFACE,
	HEADER_SURFACE_SELECTED,
	ROW_LINES,
} from "./constants";

export interface SheetGridHandle {
	reveal: (cell: CellPosition) => void;
	focus: () => void;
}

interface SheetGridProps {
	ref?: Ref<SheetGridHandle>;
	label: string;
	sheet: SheetSummary;
	widths: number[];
	getCell: (row: number, col: number) => GridCell | null | undefined;
	ensureRows: (start: number, end: number) => void;
	selection: Selection;
	onSelectionChange: (selection: Selection) => void;
	onColumnResize: (col: number, width: number | null) => void;
	onCopy: () => void;
	onSheetStep: (delta: 1 | -1) => void;
	matchKeys: Set<number> | null;
	activeMatch: CellPosition | null;
}

type DragMode = "cells" | "rows" | "cols";

export function SheetGrid({
	ref,
	label,
	sheet,
	widths,
	getCell,
	ensureRows,
	selection,
	onSelectionChange,
	onColumnResize,
	onCopy,
	onSheetStep,
	matchKeys,
	activeMatch,
}: SheetGridProps) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const drag = useRef<{ mode: DragMode; anchor: CellPosition } | null>(null);
	const { rowCount, colCount, merges } = sheet;
	const gutter = gutterWidth(rowCount);
	const starts = useMemo(() => columnStarts(widths), [widths]);
	const totalWidth = gutter + (starts.at(-1) ?? 0);
	const totalHeight = HEADER_HEIGHT + rowCount * ROW_HEIGHT;

	const rows = useVirtualizer({
		count: rowCount,
		getScrollElement: () => scrollRef.current,
		estimateSize: () => ROW_HEIGHT,
		paddingStart: HEADER_HEIGHT,
		overscan: 10,
	});
	const cols = useVirtualizer({
		horizontal: true,
		count: colCount,
		getScrollElement: () => scrollRef.current,
		estimateSize: (index) => widths[index] ?? 0,
		paddingStart: gutter,
		overscan: 3,
	});
	// biome-ignore lint/correctness/useExhaustiveDependencies: widths feed estimateSize, which the virtualizer only rereads on measure()
	useEffect(() => {
		cols.measure();
	}, [cols, widths]);

	const rowItems = rows.getVirtualItems();
	const colItems = cols.getVirtualItems();
	const firstRow = rowItems[0]?.index ?? 0;
	const lastRow = rowItems.at(-1)?.index ?? 0;
	const firstCol = colItems[0]?.index ?? 0;
	const lastCol = colItems.at(-1)?.index ?? 0;

	const visibleMerges = useMemo(
		() =>
			merges.filter(
				(merge) =>
					merge.bottom >= firstRow &&
					merge.top <= lastRow &&
					merge.right >= firstCol &&
					merge.left <= lastCol,
			),
		[merges, firstRow, lastRow, firstCol, lastCol],
	);

	useEffect(() => {
		ensureRows(firstRow, lastRow);
		for (const merge of visibleMerges) ensureRows(merge.top, merge.top);
	}, [ensureRows, firstRow, lastRow, visibleMerges]);

	const rectOf = useCallback(
		(range: CellRange) => ({
			top: HEADER_HEIGHT + range.top * ROW_HEIGHT,
			left: gutter + (starts[range.left] ?? 0),
			width: (starts[range.right + 1] ?? 0) - (starts[range.left] ?? 0),
			height: (range.bottom - range.top + 1) * ROW_HEIGHT,
		}),
		[gutter, starts],
	);

	const reveal = useCallback(
		(cell: CellPosition) => {
			const element = scrollRef.current;
			if (!element) return;
			const top = HEADER_HEIGHT + cell.row * ROW_HEIGHT;
			const y = revealOffset(
				top,
				top + ROW_HEIGHT,
				element.scrollTop,
				element.clientHeight,
				HEADER_HEIGHT,
			);
			const x = revealOffset(
				gutter + (starts[cell.col] ?? 0),
				gutter + (starts[cell.col + 1] ?? 0),
				element.scrollLeft,
				element.clientWidth,
				gutter,
			);
			if (y !== null) element.scrollTop = y;
			if (x !== null) element.scrollLeft = x;
		},
		[gutter, starts],
	);

	useImperativeHandle(
		ref,
		() => ({
			reveal,
			focus: () => scrollRef.current?.focus({ preventScroll: true }),
		}),
		[reveal],
	);

	const range = selectionRange(selection);
	const isMultiCell = range.top !== range.bottom || range.left !== range.right;
	const lastRowIndex = rowCount - 1;
	const lastColIndex = colCount - 1;
	const allCells: Selection = {
		anchor: { row: 0, col: 0 },
		head: { row: lastRowIndex, col: lastColIndex },
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const primaryKey = PLATFORM === "mac" ? event.metaKey : event.ctrlKey;
		const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
		if (primaryKey && key === "c") {
			event.preventDefault();
			onCopy();
			return;
		}
		if (primaryKey && key === "a") {
			event.preventDefault();
			onSelectionChange(allCells);
			return;
		}
		if (event.ctrlKey && (key === "PageDown" || key === "PageUp")) {
			event.preventDefault();
			onSheetStep(key === "PageDown" ? 1 : -1);
			return;
		}
		if (key === "Escape" && isMultiCell) {
			event.preventDefault();
			onSelectionChange({ anchor: selection.anchor, head: selection.anchor });
			return;
		}
		if (event.altKey) return;
		const element = scrollRef.current;
		const pageRows = element
			? Math.max(
					1,
					Math.floor((element.clientHeight - HEADER_HEIGHT) / ROW_HEIGHT) - 1,
				)
			: 1;
		const next = moveSelection(
			selection,
			{ key, shiftKey: event.shiftKey, primaryKey },
			{ rows: rowCount, cols: colCount },
			pageRows,
		);
		if (!next) return;
		// Tab at the first or last column leaves the grid instead of trapping focus.
		if (
			key === "Tab" &&
			next.anchor.row === selection.anchor.row &&
			next.anchor.col === selection.anchor.col
		) {
			return;
		}
		event.preventDefault();
		onSelectionChange(next);
		reveal(next.head);
	};

	const pointerTarget = (event: PointerEvent<HTMLDivElement>) => {
		const element = event.currentTarget;
		const bounds = element.getBoundingClientRect();
		const viewX = event.clientX - bounds.left;
		const viewY = event.clientY - bounds.top;
		const x = viewX + element.scrollLeft - gutter;
		const y = viewY + element.scrollTop - HEADER_HEIGHT;
		return {
			viewX,
			viewY,
			cell: {
				row: Math.max(0, Math.min(Math.floor(y / ROW_HEIGHT), lastRowIndex)),
				col: Math.min(columnAtOffset(starts, Math.max(0, x)), lastColIndex),
			},
			onScrollbar:
				viewX >= element.clientWidth || viewY >= element.clientHeight,
		};
	};

	const selectionFor = (
		mode: DragMode,
		anchor: CellPosition,
		head: CellPosition,
	): Selection => {
		if (mode === "rows") {
			return {
				anchor: { row: anchor.row, col: 0 },
				head: { row: head.row, col: lastColIndex },
			};
		}
		if (mode === "cols") {
			return {
				anchor: { row: 0, col: anchor.col },
				head: { row: lastRowIndex, col: head.col },
			};
		}
		return { anchor, head };
	};

	const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return;
		const { viewX, viewY, cell, onScrollbar } = pointerTarget(event);
		if (onScrollbar) return;
		const inHeader = viewY < HEADER_HEIGHT;
		const inGutter = viewX < gutter;
		if (inHeader && inGutter) {
			onSelectionChange(allCells);
			return;
		}
		const mode: DragMode = inHeader ? "cols" : inGutter ? "rows" : "cells";
		const anchor = event.shiftKey ? selection.anchor : cell;
		drag.current = { mode, anchor };
		event.currentTarget.setPointerCapture(event.pointerId);
		onSelectionChange(selectionFor(mode, anchor, cell));
	};

	const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
		const current = drag.current;
		if (!current) return;
		const { cell } = pointerTarget(event);
		const next = selectionFor(current.mode, current.anchor, cell);
		if (
			next.head.row === selection.head.row &&
			next.head.col === selection.head.col
		) {
			return;
		}
		onSelectionChange(next);
		if (current.mode === "cells") reveal(cell);
	};

	const endDrag = () => {
		drag.current = null;
	};

	const coveredBy = (row: number, col: number) =>
		visibleMerges.some(
			(merge) =>
				row >= merge.top &&
				row <= merge.bottom &&
				col >= merge.left &&
				col <= merge.right,
		);

	const matchState = (row: number, col: number): MatchState => {
		if (activeMatch && activeMatch.row === row && activeMatch.col === col) {
			return "active";
		}
		return matchKeys?.has(row * colCount + col) ? "match" : "none";
	};

	const activeRange = merges.find(
		(merge) =>
			selection.anchor.row >= merge.top &&
			selection.anchor.row <= merge.bottom &&
			selection.anchor.col >= merge.left &&
			selection.anchor.col <= merge.right,
	) ?? {
		top: selection.anchor.row,
		left: selection.anchor.col,
		bottom: selection.anchor.row,
		right: selection.anchor.col,
	};
	const activeRect = rectOf(activeRange);
	// Clamped to the rendered window so selecting a whole sheet never builds a
	// layer millions of pixels tall.
	const overlayRange = {
		top: Math.max(range.top, firstRow - 1),
		bottom: Math.min(range.bottom, lastRow + 1),
		left: Math.max(range.left, firstCol - 1),
		right: Math.min(range.right, lastCol + 1),
	};
	const overlayRect =
		isMultiCell &&
		overlayRange.top <= overlayRange.bottom &&
		overlayRange.left <= overlayRange.right
			? rectOf(overlayRange)
			: null;

	return (
		<div
			ref={scrollRef}
			role="application"
			aria-label={label}
			// biome-ignore lint/a11y/noNoninteractiveTabindex: focus is required for the keyboard navigation handlers
			tabIndex={0}
			className="group relative h-full w-full select-none overflow-auto outline-none"
			onKeyDown={handleKeyDown}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={endDrag}
			onPointerCancel={endDrag}
		>
			<div
				className="relative"
				style={{ width: totalWidth, height: totalHeight }}
			>
				<div
					className="absolute top-0 left-0 z-0"
					style={{
						width: totalWidth,
						height: totalHeight,
						backgroundImage: ROW_LINES,
						backgroundPosition: `0 ${HEADER_HEIGHT}px`,
					}}
				>
					{colItems.map((colItem) => (
						<div
							key={`line:${colItem.index}`}
							className="absolute w-px bg-border"
							style={{
								left: gutter + (starts[colItem.index + 1] ?? 0) - 1,
								top: rowItems[0]?.start ?? 0,
								height: rowItems.length * ROW_HEIGHT,
							}}
						/>
					))}
					{rowItems.map((rowItem) =>
						colItems.map((colItem) => {
							const row = rowItem.index;
							const col = colItem.index;
							if (coveredBy(row, col)) return null;
							return (
								<SheetCell
									key={`${row}:${col}`}
									top={rowItem.start}
									left={gutter + (starts[col] ?? 0)}
									width={(widths[col] ?? 0) - 1}
									height={ROW_HEIGHT - 1}
									cell={getCell(row, col)}
									match={matchState(row, col)}
								/>
							);
						}),
					)}
					{visibleMerges.map((merge) => {
						const rect = rectOf(merge);
						return (
							<SheetCell
								key={`merge:${merge.top}:${merge.left}`}
								top={rect.top}
								left={rect.left}
								width={rect.width - 1}
								height={rect.height - 1}
								cell={getCell(merge.top, merge.left)}
								match={matchState(merge.top, merge.left)}
								merged
							/>
						);
					})}
					{overlayRect && (
						<div
							className="pointer-events-none absolute z-[2] border border-primary/40 bg-primary/10"
							style={overlayRect}
						/>
					)}
					<div
						className="pointer-events-none absolute z-[3] border-2 border-muted-foreground/50 group-focus:border-primary"
						style={{
							top: activeRect.top - 1,
							left: activeRect.left - 1,
							width: activeRect.width + 1,
							height: activeRect.height + 1,
						}}
					/>
				</div>
				<div
					className="sticky top-0 z-20 flex"
					style={{ width: totalWidth, height: HEADER_HEIGHT }}
				>
					<div
						className={cn(
							"sticky left-0 z-10 h-full shrink-0 border-border border-r border-b",
							HEADER_SURFACE,
						)}
						style={{ width: gutter }}
					/>
					<div
						className="relative h-full"
						style={{ width: totalWidth - gutter }}
					>
						{colItems.map((colItem) => (
							<ColumnHeader
								key={colItem.index}
								col={colItem.index}
								left={starts[colItem.index] ?? 0}
								width={widths[colItem.index] ?? 0}
								selected={
									colItem.index >= range.left && colItem.index <= range.right
								}
								onResize={onColumnResize}
							/>
						))}
					</div>
				</div>
				<div
					className="sticky left-0 z-10"
					style={{ width: gutter, height: totalHeight - HEADER_HEIGHT }}
				>
					{rowItems.map((rowItem) => {
						const selected =
							rowItem.index >= range.top && rowItem.index <= range.bottom;
						return (
							<div
								key={rowItem.index}
								className={cn(
									"absolute left-0 w-full border-border border-r border-b pr-1.5 text-right text-[11px] tabular-nums leading-6",
									selected
										? `${HEADER_SURFACE_SELECTED} text-foreground`
										: `${HEADER_SURFACE} text-muted-foreground`,
								)}
								style={{
									top: rowItem.start - HEADER_HEIGHT,
									height: ROW_HEIGHT,
								}}
							>
								{rowItem.index + 1}
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
