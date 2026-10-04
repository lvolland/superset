import { Trans } from "@lingui/react/macro";
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
import { useSheetSearch } from "../../hooks/useSheetSearch";
import type { CellPosition, SheetSummary } from "../../types";
import { estimateColumnWidth, rangeAddress } from "../../utils/gridGeometry";
import { RowBlockCache } from "../../utils/RowBlockCache";
import {
	clampSelection,
	collapsed,
	ORIGIN,
	type Selection,
	selectionRange,
} from "../../utils/selection";
import type { SheetWorkerClient } from "../../utils/sheetWorker";
import { FormulaBar } from "../FormulaBar";
import { SheetGrid, type SheetGridHandle } from "../SheetGrid";
import { SheetMessage } from "../SheetMessage";
import { SheetSearch } from "../SheetSearch";
import { SheetTabs } from "../SheetTabs";

interface WorkbookViewerProps {
	client: SheetWorkerClient;
	sheets: SheetSummary[];
	isActive: boolean;
	embedded: boolean;
}

export function WorkbookViewer({
	client,
	sheets,
	isActive,
	embedded,
}: WorkbookViewerProps) {
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
	const [, onRowsLoaded] = useReducer((count: number) => count + 1, 0);
	const gridRef = useRef<SheetGridHandle>(null);
	const { copyToClipboard } = useCopyToClipboard();

	const sheet = sheets[sheetIndex];
	const bounds = { rows: sheet?.rowCount ?? 0, cols: sheet?.colCount ?? 0 };
	const selection = clampSelection(
		selections[sheetIndex] ?? collapsed(ORIGIN),
		bounds,
	);

	const cache = useMemo(
		() =>
			new RowBlockCache(
				(start, end) =>
					client.request({ type: "rows", sheet: sheetIndex, start, end }),
				onRowsLoaded,
			),
		[client, sheetIndex],
	);
	useEffect(() => () => cache.dispose(), [cache]);
	const ensureRows = useCallback(
		(start: number, end: number) => cache.ensure(start, end),
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
			setSelections((current) => ({ ...current, [sheetIndex]: next }));
		},
		[sheetIndex],
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

	const handleCopy = () => {
		client
			.request({
				type: "tsv",
				sheet: sheetIndex,
				range: selectionRange(selection),
			})
			.then(copyToClipboard)
			.catch(() => {});
	};

	if (!sheet) return null;

	const isEmpty = sheet.rowCount === 0 || sheet.colCount === 0;
	const range = selectionRange(selection);

	return (
		<div className="relative flex h-full w-full flex-col bg-background">
			{!embedded && !isEmpty && (
				<FormulaBar
					address={rangeAddress(range)}
					cell={getCell(selection.anchor.row, selection.anchor.col)}
				/>
			)}
			<div className="relative min-h-0 flex-1">
				{isEmpty ? (
					<SheetMessage>
						{sheets.length > 1 ? (
							<Trans>Empty sheet</Trans>
						) : (
							<Trans>Empty file</Trans>
						)}
					</SheetMessage>
				) : (
					<SheetGrid
						key={sheetIndex}
						ref={gridRef}
						label={sheet.name}
						sheet={sheet}
						widths={widths}
						getCell={getCell}
						ensureRows={ensureRows}
						selection={selection}
						onSelectionChange={setSelection}
						onColumnResize={handleColumnResize}
						onCopy={handleCopy}
						onSheetStep={(delta) =>
							selectSheet(
								Math.max(0, Math.min(sheets.length - 1, sheetIndex + delta)),
							)
						}
						matchKeys={search.matchKeys}
						activeMatch={search.activeMatch}
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
