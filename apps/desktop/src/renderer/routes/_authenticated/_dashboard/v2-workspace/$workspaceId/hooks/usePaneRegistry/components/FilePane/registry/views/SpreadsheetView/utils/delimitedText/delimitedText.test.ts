import { expect, test } from "bun:test";
import {
	delimitedSource,
	guessSeparator,
	parseDelimitedText,
} from "./delimitedText";

const texts = (text: string, separator: string) =>
	parseDelimitedText(text, separator).map((row) =>
		Array.from(row, (cell) => cell?.v ?? ""),
	);

test("parses quoted fields, CRLF, trailing separators and an unclosed quote", () => {
	expect(texts('a,"b\r\nc",\r\n"x""y"z,"open\n', ",")).toEqual([
		["a", "b\r\nc"],
		['x"yz', "open\n"],
	]);
	expect(texts("", ",")).toEqual([]);
});

test("guesses the separator outside quotes and honours a sep= line", () => {
	expect(guessSeparator('"a;b;c",d,e\n')).toBe(",");
	expect(guessSeparator("a;b\tc;d\n")).toBe(";");
	expect(guessSeparator("single\n")).toBe(",");
	expect(delimitedSource("sep=|\r\na|b", null)).toEqual({
		text: "a|b",
		separator: "|",
	});
	expect(delimitedSource("a,b\tc", "\t").separator).toBe("\t");
});
