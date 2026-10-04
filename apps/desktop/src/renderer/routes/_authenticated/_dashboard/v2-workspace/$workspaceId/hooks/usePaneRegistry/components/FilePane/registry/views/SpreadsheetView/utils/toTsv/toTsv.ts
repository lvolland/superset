const NEEDS_QUOTES = /[\t\n\r"]/;

export function tsvField(field: string): string {
	return NEEDS_QUOTES.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
}

/** Spreadsheet clipboard format: Excel and Numbers paste it back into cells. */
export function toTsv(rows: string[][]): string {
	return rows.map((row) => row.map(tsvField).join("\t")).join("\n");
}
