const NEEDS_QUOTES = /[\t\n\r"]/;

/** Spreadsheet clipboard format: Excel and Numbers paste it back into cells. */
export function toTsv(rows: string[][]): string {
	return rows
		.map((row) =>
			row
				.map((field) =>
					NEEDS_QUOTES.test(field) ? `"${field.replaceAll('"', '""')}"` : field,
				)
				.join("\t"),
		)
		.join("\n");
}
