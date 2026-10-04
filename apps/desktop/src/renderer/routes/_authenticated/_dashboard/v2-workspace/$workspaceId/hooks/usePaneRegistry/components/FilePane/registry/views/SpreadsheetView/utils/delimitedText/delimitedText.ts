import type { CellObject } from "xlsx";

const QUOTE = 0x22;
const LF = 0x0a;
const CR = 0x0d;
const SNIFF_CHARS = 1024;
// Most frequent wins; on a tie, the earlier one.
const CANDIDATES = [",", "\t", ";", "|"];

export interface DelimitedText {
	text: string;
	separator: string;
}

/** A leading `sep=;` line names the separator, as Excel writes it. */
export function delimitedSource(
	text: string,
	fallback: string | null,
): DelimitedText {
	const declared = /^sep=(.)(\r\n|\r|\n)/.exec(text);
	if (declared?.[1]) {
		return { text: text.slice(declared[0].length), separator: declared[1] };
	}
	return { text, separator: fallback ?? guessSeparator(text) };
}

export function guessSeparator(text: string): string {
	const counts = new Map<string, number>();
	let quoted = false;
	const end = Math.min(text.length, SNIFF_CHARS);
	for (let i = 0; i < end; i += 1) {
		const char = text[i] as string;
		if (char === '"') quoted = !quoted;
		else if (!quoted && CANDIDATES.includes(char)) {
			counts.set(char, (counts.get(char) ?? 0) + 1);
		}
	}
	let best = ",";
	let bestCount = 0;
	for (const candidate of CANDIDATES) {
		const count = counts.get(candidate) ?? 0;
		if (count > bestCount) {
			best = candidate;
			bestCount = count;
		}
	}
	return best;
}

/** RFC 4180 fields, kept as written: no number, date or formula guessing. */
export function parseDelimitedText(
	text: string,
	separator: string,
): CellObject[][] {
	const sep = separator.charCodeAt(0);
	const length = text.length;
	const rows: CellObject[][] = [];
	let row: CellObject[] = [];
	let col = 0;
	let i = 0;

	const fieldEnd = (from: number) => {
		let end = from;
		while (end < length) {
			const code = text.charCodeAt(end);
			if (code === sep || code === LF || code === CR) break;
			end += 1;
		}
		return end;
	};

	while (i < length) {
		let value: string;
		if (text.charCodeAt(i) === QUOTE) {
			value = "";
			let from = i + 1;
			for (;;) {
				const close = text.indexOf('"', from);
				if (close === -1) {
					value += text.slice(from);
					i = length;
					break;
				}
				value += text.slice(from, close);
				if (text.charCodeAt(close + 1) === QUOTE) {
					value += '"';
					from = close + 2;
					continue;
				}
				i = close + 1;
				break;
			}
			const end = fieldEnd(i);
			value += text.slice(i, end);
			i = end;
		} else {
			const end = fieldEnd(i);
			value = text.slice(i, end);
			i = end;
		}
		if (value) row[col] = { t: "s", v: value, w: value };

		const code = text.charCodeAt(i);
		if (code === sep) {
			col += 1;
			i += 1;
			continue;
		}
		rows.push(row);
		row = [];
		col = 0;
		if (code === CR) i += text.charCodeAt(i + 1) === LF ? 2 : 1;
		else if (code === LF) i += 1;
	}
	if (col > 0 || row.length > 0) rows.push(row);
	return rows;
}
