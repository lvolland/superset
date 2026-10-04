import {
	openWorkbook,
	unreadableReason,
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
		case "cells":
			return model.getCells(request.sheet, request.window, request.numbers);
		case "search":
			return model.search(
				request.sheet,
				request.query,
				request.caseSensitive,
				request.limit,
				request.numbers,
			);
		case "tsv":
			return model.rangeToTsv(request.sheet, request.range, request.numbers);
	}
}

self.onmessage = (event: MessageEvent<SheetRequest>) => {
	const request = event.data;
	let response: SheetResponse;
	try {
		response = { id: request.id, ok: true, result: handle(request) };
	} catch (error) {
		response = { id: request.id, ok: false, reason: unreadableReason(error) };
	}
	self.postMessage(response);
};
