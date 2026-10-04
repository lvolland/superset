import {
	openWorkbook,
	UnreadableWorkbookError,
	type WorkbookModel,
} from "../workbookModel";
import type { SheetRequest, SheetResponse, SheetResults } from "./protocol";

let model: WorkbookModel | null = null;

function handle(request: SheetRequest): SheetResults[keyof SheetResults] {
	if (request.type === "open") {
		model = null;
		model = openWorkbook(request.source);
		return model.sheets;
	}
	if (!model) throw new Error("No workbook is open");
	switch (request.type) {
		case "rows":
			return model.getRows(request.sheet, request.start, request.end);
		case "search":
			return model.search(
				request.sheet,
				request.query,
				request.caseSensitive,
				request.limit,
			);
		case "tsv":
			return model.rangeToTsv(request.sheet, request.range);
	}
}

self.onmessage = (event: MessageEvent<SheetRequest>) => {
	const request = event.data;
	let response: SheetResponse;
	try {
		response = { id: request.id, ok: true, result: handle(request) };
	} catch (error) {
		response = {
			id: request.id,
			ok: false,
			message:
				error instanceof UnreadableWorkbookError
					? ""
					: error instanceof Error
						? error.message
						: String(error),
		};
	}
	self.postMessage(response);
};
