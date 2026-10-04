import { useLingui } from "@lingui/react/macro";
import { useFormat } from "@superset/i18n/react";
import { toast } from "@superset/ui/sonner";
import {
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import { useCopyToClipboard } from "renderer/hooks/useCopyToClipboard";
import { useHotkey } from "renderer/hotkeys";
import { ErrorState } from "../../../../../components/ErrorState";
import { useSheetSearch } from "../../hooks/useSheetSearch";
import type { CellPosition, CellRange, SheetSummary } from "../../types";
import { CellBlockCache } from "../../utils/CellBlockCache";
import {
	cellAddress,
	estimateColumnWidth,
	rangeAddress,
} from "../../utils/gridGeometry";
import {
	activeCellRange,
	clampSelection,
	collapsed,
	normalizeSelection,
	ORIGIN,
	type Selection,
	selectionRange,
} from "../../utils/selection";
import type { SheetWorkerClient } from "../../utils/sheetWorker";
import { FormulaBar } from "../FormulaBar";
import { SheetGrid, type SheetGridHandle } from "../SheetGrid";
import { SheetSearch } from "../SheetSearch";
import { SheetTabs } from "../SheetTabs";

interface WorkbookViewerProps {
	client: SheetWorkerClient;
	sheets: SheetSummary[];
	isActive: boolean;
	embedded: boolean;
}

const sameRange = (a: CellRange, b: CellRange) =>
	a.top === b.top &&
	a.left === b.left &&
	a.bottom === b.bottom &&
	a.right === b.right;

export function WorkbookViewer({
	client,
	sheets,
	isActive,
	embedded,
}: WorkbookViewerProps) {
	const { t } = useLingui();
	const { formatNumber, getNumberSeparators } = useFormat();
	const numbers = useMemo(() => getNumberSeparators(), [getNumberSeparators]);
	const [sheetIndex, selectSheet] = useState(() =>
		Math.max(
			0,
			sheets.findIndex((sheet) => !sheet.hidden),
		),
	);
	const [selections, setSelections] = useState<Record<number, Selection>>({});
	const [widthOverrides, setWidthOverrides] = useState<
		Record<number, Record<number, number>>
	>({});
	const [, onCellsLoaded] = useReducer((count: number) => count + 1, 0);
	const gridRef = useRef<SheetGridHandle>(null);
	const { copyToClipboard } = useCopyToClipboard();

	const sheet = sheets[sheetIndex];
	const merges = sheet?.merges ?? [];
	const bounds = { rows: sheet?.rowCount ?? 0, cols: sheet?.colCount ?? 0 };
	const selection = clampSelection(
		selections[sheetIndex] ?? collapsed(ORIGIN),
		bounds,
	);

	const cache = useMemo(
		() =>
			new CellBlockCache(
				(window) =>
					client.request({
						type: "cells",
						sheet: sheetIndex,
						window,
						numbers,
					}),
				onCellsLoaded,
			),
		[client, sheetIndex, numbers],
	);
	useEffect(() => () => cache.dispose(), [cache]);
	const ensureCells = useCallback(
		(ranges: CellRange[]) => cache.ensure(ranges),
		[cache],
	);
	const getCell = useCallback(
		(row: number, col: number) => cache.getCell(row, col),
		[cache],
	);

	const sheetWidths = widthOverrides[sheetIndex];
	const widths = useMemo(
		() =>
			(sheet?.colChars ?? []).map(
				(chars, col) => sheetWidths?.[col] ?? estimateColumnWidth(chars),
			),
		[sheet, sheetWidths],
	);

	const setSelection = useCallback(
		(next: Selection) => {
			setSelections((current) => ({
				...current,
				[sheetIndex]: normalizeSelection(next, merges),
			}));
		},
		[sheetIndex, merges],
	);

	const revealCell = useCallback(
		(cell: CellPosition) => {
			setSelection(collapsed(cell));
			gridRef.current?.reveal(cell);
		},
		[setSelection],
	);

	const search = useSheetSearch({
		client,
		sheetIndex,
		colCount: sheet?.colCount ?? 0,
		numbers,
		onReveal: revealCell,
	});

	useHotkey(
		"FIND_IN_FILE_VIEWER",
		() => {
			if (search.isOpen) {
				search.close();
				gridRef.current?.focus();
			} else {
				search.open();
			}
		},
		{ enabled: isActive && !embedded, preventDefault: true },
	);

	const handleColumnResize = useCallback(
		(col: number, width: number | null) => {
			setWidthOverrides((current) => {
				const sheetOverrides = { ...current[sheetIndex] };
				if (width === null) delete sheetOverrides[col];
				else sheetOverrides[col] = width;
				return { ...current, [sheetIndex]: sheetOverrides };
			});
		},
		[sheetIndex],
	);

	const range = selectionRange(selection, merges);
	const active = activeCellRange(selection, merges);

	const handleCopy = () => {
		client
			.request({ type: "tsv", sheet: sheetIndex, range, numbers })
			.then(async (copy) => {
				await copyToClipboard(copy.text);
				if (copy.truncated) {
					const count = formatNumber(copy.cells);
					toast.warning(t`Copied the first ${count} cells of the selection`);
				}
			})
			.catch(() => {});
	};

	if (!sheet) return null;

	const isEmpty = sheet.rowCount === 0 || sheet.colCount === 0;

	return (
		<div className="relative flex h-full w-full flex-col bg-background">
			{!embedded && (
				<FormulaBar
					address={
						isEmpty
							? ""
							: sameRange(range, active)
								? cellAddress(selection.anchor)
								: rangeAddress(range)
					}
					cell={
						isEmpty ? null : getCell(selection.anchor.row, selection.anchor.col)
					}
				/>
			)}
			<div className="relative min-h-0 flex-1">
				{isEmpty ? (
					<ErrorState
						reason="load-failed"
						message={sheets.length > 1 ? t`Empty sheet` : t`Empty file`}
					/>
				) : (
					<SheetGrid
						key={sheetIndex}
						ref={gridRef}
						label={sheet.name}
						sheet={sheet}
						widths={widths}
						getCell={getCell}
						ensureCells={ensureCells}
						selection={selection}
						onSelectionChange={setSelection}
						onColumnResize={handleColumnResize}
						onCopy={handleCopy}
						onSheetStep={(delta) =>
							selectSheet(
								Math.max(0, Math.min(sheets.length - 1, sheetIndex + delta)),
							)
						}
						matchKeys={search.isOpen ? search.matchKeys : null}
						activeMatch={search.isOpen ? search.activeMatch : null}
					/>
				)}
				{search.isOpen && !isEmpty && (
					<SheetSearch
						query={search.query}
						caseSensitive={search.caseSensitive}
						matchCount={search.matchCount}
						truncated={search.truncated}
						activeIndex={search.activeIndex}
						onQueryChange={search.setQuery}
						onCaseSensitiveChange={search.setCaseSensitive}
						onFindNext={search.findNext}
						onFindPrevious={search.findPrevious}
						onClose={() => {
							search.close();
							gridRef.current?.focus();
						}}
					/>
				)}
			</div>
			{sheets.length > 1 && (
				<SheetTabs
					sheets={sheets}
					activeIndex={sheetIndex}
					onSelect={selectSheet}
				/>
			)}
		</div>
	);
}
