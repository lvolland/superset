import type {
	CellRange,
	GridCell,
	SearchResult,
	SheetSummary,
	WorkbookSource,
} from "../../types";

export type SheetRequestBody =
	| { type: "open"; source: WorkbookSource }
	| { type: "rows"; sheet: number; start: number; end: number }
	| {
			type: "search";
			sheet: number;
			query: string;
			caseSensitive: boolean;
			limit: number;
	  }
	| { type: "tsv"; sheet: number; range: CellRange };

export interface SheetResults {
	open: SheetSummary[];
	rows: (GridCell | null)[][];
	search: SearchResult;
	tsv: string;
}

export type SheetRequest = SheetRequestBody & { id: number };

export type SheetResponse =
	| { id: number; ok: true; result: SheetResults[keyof SheetResults] }
	/** message is empty when the library has nothing to add to "unreadable". */
	| { id: number; ok: false; message: string };
