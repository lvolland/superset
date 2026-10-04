import { describe, expect, test } from "bun:test";
import { utils, write } from "xlsx";
import { openWorkbook, UnreadableWorkbookError } from "./workbookModel";

function buildWorkbook(): Uint8Array {
	const book = utils.book_new();
	const sales = utils.aoa_to_sheet([
		["Mois", "CA"],
		["Janvier", 5200],
		["Février", 7280],
	]);
	sales.B2.z = "#,##0.00";
	sales.A4 = { t: "s", v: "Total" };
	sales.B4 = { t: "n", v: 12480, f: "SUM(B2:B3)" };
	sales["!ref"] = "A1:B4";
	sales["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
	utils.book_append_sheet(book, sales, "Ventes");
	utils.book_append_sheet(book, utils.aoa_to_sheet([["Nom"]]), "Clients");
	return new Uint8Array(write(book, { type: "array", bookType: "xlsx" }));
}

describe("openWorkbook", () => {
	test("reads a semicolon CSV with quotes and a BOM, keeping the text as written", () => {
		const model = openWorkbook({
			kind: "text",
			fileName: "ventes.csv",
			text: '﻿Mois;CA\n"Jan; vier";5200,50\n"dit ""ok""";01234\n',
		});
		expect(model.sheets).toHaveLength(1);
		expect(model.sheets[0]).toMatchObject({ rowCount: 3, colCount: 2 });
		const rows = model.getRows(0, 0, 3);
		expect(rows[0]?.[0]?.text).toBe("Mois");
		expect(rows[1]?.[0]).toEqual({ text: "Jan; vier", kind: "text" });
		expect(rows[1]?.[1]).toEqual({ text: "5200,50", kind: "number" });
		expect(rows[2]?.[0]?.text).toBe('dit "ok"');
		expect(rows[2]?.[1]?.text).toBe("01234");
	});

	test("reads an xlsx with formulas, formatted numbers, merges and two sheets", () => {
		const model = openWorkbook({
			kind: "bytes",
			fileName: "ventes.xlsx",
			bytes: buildWorkbook(),
		});
		expect(model.sheets.map((sheet) => sheet.name)).toEqual([
			"Ventes",
			"Clients",
		]);
		expect(model.sheets[0]).toMatchObject({
			rowCount: 4,
			colCount: 2,
			merges: [{ top: 0, left: 0, bottom: 0, right: 1 }],
		});
		const rows = model.getRows(0, 0, 4);
		expect(rows[1]?.[1]).toEqual({
			text: "5,200.00",
			kind: "number",
			value: "5200",
		});
		expect(rows[3]?.[1]).toEqual({
			text: "12480",
			kind: "number",
			formula: "=SUM(B2:B3)",
		});
		expect(model.getRows(1, 0, 1)[0]?.[0]?.text).toBe("Nom");
	});

	test("finds matches in reading order and copies a range as TSV", () => {
		const model = openWorkbook({
			kind: "text",
			fileName: "a.csv",
			text: "pomme,Poire\nraisin,pomme verte\n",
		});
		expect(model.search(0, "POMME", false, 10).matches).toEqual([0, 0, 1, 1]);
		expect(model.search(0, "POMME", true, 10).matches).toEqual([]);
		expect(model.search(0, "pomme", false, 1)).toEqual({
			matches: [0, 0],
			truncated: true,
		});
		expect(model.rangeToTsv(0, { top: 0, left: 1, bottom: 1, right: 2 })).toBe(
			"Poire\t\npomme verte\t",
		);
	});

	test("rejects a workbook whose bytes are not an archive", () => {
		expect(() =>
			openWorkbook({
				kind: "bytes",
				fileName: "broken.xlsx",
				bytes: new TextEncoder().encode("not a workbook"),
			}),
		).toThrow(UnreadableWorkbookError);
	});

	test("an empty CSV has no rows", () => {
		const model = openWorkbook({ kind: "text", fileName: "e.csv", text: "" });
		expect(model.sheets[0]).toMatchObject({ rowCount: 0, colCount: 0 });
	});
});
