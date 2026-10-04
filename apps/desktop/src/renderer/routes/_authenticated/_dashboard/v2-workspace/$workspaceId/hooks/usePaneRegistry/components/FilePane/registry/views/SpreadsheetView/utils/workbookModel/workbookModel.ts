import { getFileExtension } from "@superset/shared/media-files";
import { type CellObject, read, utils, type WorkBook } from "xlsx";
import type {
	CellKind,
	CellRange,
	GridCell,
	SearchResult,
	SheetSummary,
	WorkbookSource,
} from "../../types";
import { toTsv } from "../toTsv";

const WIDTH_SAMPLE_ROWS = 1000;
const MAX_SAMPLED_CHARS = 60;
const ZIP_EXTENSIONS = new Set(["xlsx", "xlsm", "xlsb", "ods"]);
const NUMERIC_TEXT =
	/^[-+(]?[$€£¥]?\s?\d[\d\s.,'  ]*(?:[eE][-+]?\d+)?\s?[%$€£¥]?\)?$/;

export class UnreadableWorkbookError extends Error {}

export interface WorkbookModel {
	sheets: SheetSummary[];
	getRows(
		sheetIndex: number,
		start: number,
		end: number,
	): (GridCell | null)[][];
	search(
		sheetIndex: number,
		query: string,
		caseSensitive: boolean,
		limit: number,
	): SearchResult;
	rangeToTsv(sheetIndex: number, range: CellRange): string;
}

export function openWorkbook(source: WorkbookSource): WorkbookModel {
	const workbook =
		source.kind === "text" ? readDelimitedText(source.text) : readBytes(source);
	const delimited = source.kind === "text";
	const sheets = workbook.SheetNames.map((name, index) =>
		summarize(workbook, name, index),
	);
	const data = workbook.SheetNames.map((name) => sheetData(workbook, name));

	const cellAt = (sheetIndex: number, r: number, c: number) =>
		data[sheetIndex]?.[r]?.[c];

	return {
		sheets,
		getRows(sheetIndex, start, end) {
			const sheet = sheets[sheetIndex];
			if (!sheet) return [];
			const rows: (GridCell | null)[][] = [];
			const last = Math.min(end, sheet.rowCount);
			for (let r = start; r < last; r += 1) {
				const source = data[sheetIndex]?.[r];
				const row: (GridCell | null)[] = [];
				if (source) {
					for (let c = 0; c < source.length; c += 1) {
						row.push(toGridCell(source[c], delimited));
					}
				}
				rows.push(row);
			}
			return rows;
		},
		search(sheetIndex, query, caseSensitive, limit) {
			const needle = caseSensitive ? query : query.toLowerCase();
			const matches: number[] = [];
			const rows = data[sheetIndex];
			if (!needle || !rows) return { matches, truncated: false };
			for (let r = 0; r < rows.length; r += 1) {
				const row = rows[r];
				if (!row) continue;
				for (let c = 0; c < row.length; c += 1) {
					const text = cellText(row[c]);
					if (!text) continue;
					const haystack = caseSensitive ? text : text.toLowerCase();
					if (!haystack.includes(needle)) continue;
					if (matches.length / 2 >= limit) {
						return { matches, truncated: true };
					}
					matches.push(r, c);
				}
			}
			return { matches, truncated: false };
		},
		rangeToTsv(sheetIndex, range) {
			const rows: string[][] = [];
			for (let r = range.top; r <= range.bottom; r += 1) {
				const row: string[] = [];
				for (let c = range.left; c <= range.right; c += 1) {
					row.push(cellText(cellAt(sheetIndex, r, c)));
				}
				rows.push(row);
			}
			return toTsv(rows);
		},
	};
}

function readDelimitedText(text: string): WorkBook {
	const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
	// raw keeps the text as written: SheetJS would read "5200,50" as 520050.
	return read(withoutBom, {
		type: "string",
		dense: true,
		raw: true,
		cellHTML: false,
	});
}

function readBytes(source: Extract<WorkbookSource, { kind: "bytes" }>) {
	const extension = getFileExtension(source.fileName);
	if (ZIP_EXTENSIONS.has(extension) && !hasZipSignature(source.bytes)) {
		throw new UnreadableWorkbookError("Not a valid workbook archive");
	}
	return read(source.bytes, {
		type: "array",
		dense: true,
		cellFormula: true,
		cellHTML: false,
		cellNF: false,
		cellStyles: false,
	});
}

function hasZipSignature(bytes: Uint8Array): boolean {
	return (
		bytes.length >= 4 &&
		bytes[0] === 0x50 &&
		bytes[1] === 0x4b &&
		bytes[2] === 0x03 &&
		bytes[3] === 0x04
	);
}

function sheetData(workbook: WorkBook, name: string): CellObject[][] {
	return (workbook.Sheets[name]?.["!data"] as CellObject[][] | undefined) ?? [];
}

function summarize(
	workbook: WorkBook,
	name: string,
	index: number,
): SheetSummary {
	const sheet = workbook.Sheets[name];
	const rows = sheetData(workbook, name);
	let rowCount = 0;
	let colCount = 0;
	const colChars: number[] = [];
	for (let r = 0; r < rows.length; r += 1) {
		const row = rows[r];
		if (!row) continue;
		for (let c = 0; c < row.length; c += 1) {
			const text = cellText(row[c]);
			if (!text) continue;
			rowCount = r + 1;
			if (c + 1 > colCount) colCount = c + 1;
			if (r < WIDTH_SAMPLE_ROWS) {
				const chars = Math.min(longestLine(text), MAX_SAMPLED_CHARS);
				if (chars > (colChars[c] ?? 0)) colChars[c] = chars;
			}
		}
	}
	const merges = (sheet?.["!merges"] ?? [])
		.map((merge) => ({
			top: merge.s.r,
			left: merge.s.c,
			bottom: merge.e.r,
			right: merge.e.c,
		}))
		.filter((merge) => merge.top < rowCount && merge.left < colCount);
	for (const merge of merges) {
		rowCount = Math.max(rowCount, merge.bottom + 1);
		colCount = Math.max(colCount, merge.right + 1);
	}
	return {
		name,
		hidden: Boolean(workbook.Workbook?.Sheets?.[index]?.Hidden),
		rowCount,
		colCount,
		colChars: Array.from({ length: colCount }, (_, c) => colChars[c] ?? 0),
		merges,
	};
}

function longestLine(text: string): number {
	let longest = 0;
	for (const line of text.split("\n")) {
		if (line.length > longest) longest = line.length;
	}
	return longest;
}

export function cellText(cell: CellObject | undefined): string {
	if (!cell) return "";
	if (cell.w !== undefined) return cell.w;
	if (cell.v === undefined || cell.v === null) return "";
	try {
		return utils.format_cell(cell);
	} catch {
		return String(cell.v);
	}
}

function toGridCell(
	cell: CellObject | undefined,
	delimited: boolean,
): GridCell | null {
	if (!cell) return null;
	const text = cellText(cell);
	const formula = cell.f ? `=${cell.f}` : undefined;
	if (!text && !formula) return null;
	const kind = cellKind(cell, text, delimited);
	const value = rawValue(cell);
	return {
		text,
		kind,
		...(formula ? { formula } : {}),
		...(value !== undefined && value !== text ? { value } : {}),
	};
}

function cellKind(
	cell: CellObject,
	text: string,
	delimited: boolean,
): CellKind {
	if (delimited) return NUMERIC_TEXT.test(text.trim()) ? "number" : "text";
	switch (cell.t) {
		case "n":
		case "d":
			return "number";
		case "b":
			return "boolean";
		case "e":
			return "error";
		default:
			return "text";
	}
}

function rawValue(cell: CellObject): string | undefined {
	if (cell.v === undefined || cell.v === null) return undefined;
	if (cell.t === "b") return cell.v ? "TRUE" : "FALSE";
	if (cell.v instanceof Date) return cell.v.toISOString();
	return String(cell.v);
}
