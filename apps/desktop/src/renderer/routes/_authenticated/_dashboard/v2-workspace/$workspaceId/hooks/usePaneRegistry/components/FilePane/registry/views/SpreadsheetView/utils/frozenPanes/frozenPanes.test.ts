import { expect, test } from "bun:test";
import { parseFrozenPane } from "./frozenPanes";

test("reads frozen rows and columns from the first sheet view only", () => {
	expect(
		parseFrozenPane(
			'<x:sheetViews><x:sheetView tabSelected="1"><x:pane xSplit="2" ySplit="1" topLeftCell="C2" state="frozenSplit"/></x:sheetView><x:sheetView><x:pane ySplit="9" state="frozen"/></x:sheetView></x:sheetViews>',
		),
	).toEqual({ rows: 1, cols: 2 });
	expect(
		parseFrozenPane(
			'<sheetViews><sheetView><pane xSplit="2400" ySplit="1200" state="split"/></sheetView></sheetViews>',
		),
	).toEqual({ rows: 0, cols: 0 });
	expect(
		parseFrozenPane('<sheetViews><sheetView workbookViewId="0"/></sheetViews>'),
	).toEqual({
		rows: 0,
		cols: 0,
	});
});
