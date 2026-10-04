import { useCallback, useEffect, useMemo, useState } from "react";
import type { CellPosition, SearchResult } from "../../types";
import type { SheetWorkerClient } from "../../utils/sheetWorker";

const MATCH_LIMIT = 10_000;
const QUERY_DELAY_MS = 120;

interface UseSheetSearchOptions {
	client: SheetWorkerClient;
	sheetIndex: number;
	colCount: number;
	onReveal: (cell: CellPosition) => void;
}

export function useSheetSearch({
	client,
	sheetIndex,
	colCount,
	onReveal,
}: UseSheetSearchOptions) {
	const [isOpen, setIsOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [caseSensitive, setCaseSensitive] = useState(false);
	const [result, setResult] = useState<SearchResult | null>(null);
	const [activeIndex, setActiveIndex] = useState(0);

	useEffect(() => {
		if (!isOpen || !query) {
			setResult(null);
			return;
		}
		let cancelled = false;
		const timer = setTimeout(() => {
			client
				.request({
					type: "search",
					sheet: sheetIndex,
					query,
					caseSensitive,
					limit: MATCH_LIMIT,
				})
				.then(
					(next) => {
						if (cancelled) return;
						setResult(next);
						setActiveIndex(0);
						const [row, col] = next.matches;
						if (row !== undefined && col !== undefined) onReveal({ row, col });
					},
					() => {},
				);
		}, QUERY_DELAY_MS);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [client, sheetIndex, query, caseSensitive, isOpen, onReveal]);

	const matchCount = result ? result.matches.length / 2 : 0;

	const matchKeys = useMemo(() => {
		if (!result || result.matches.length === 0) return null;
		const keys = new Set<number>();
		for (let i = 0; i < result.matches.length; i += 2) {
			keys.add(
				(result.matches[i] ?? 0) * colCount + (result.matches[i + 1] ?? 0),
			);
		}
		return keys;
	}, [result, colCount]);

	const matchAt = useCallback(
		(index: number): CellPosition | null => {
			const row = result?.matches[index * 2];
			const col = result?.matches[index * 2 + 1];
			return row === undefined || col === undefined ? null : { row, col };
		},
		[result],
	);

	const step = useCallback(
		(delta: 1 | -1) => {
			if (matchCount === 0) return;
			const next = (activeIndex + delta + matchCount) % matchCount;
			setActiveIndex(next);
			const cell = matchAt(next);
			if (cell) onReveal(cell);
		},
		[activeIndex, matchCount, matchAt, onReveal],
	);

	return {
		isOpen,
		open: () => setIsOpen(true),
		close: () => setIsOpen(false),
		query,
		setQuery,
		caseSensitive,
		setCaseSensitive,
		matchCount,
		truncated: result?.truncated ?? false,
		activeIndex,
		activeMatch: isOpen ? matchAt(activeIndex) : null,
		matchKeys: isOpen ? matchKeys : null,
		findNext: () => step(1),
		findPrevious: () => step(-1),
	};
}
