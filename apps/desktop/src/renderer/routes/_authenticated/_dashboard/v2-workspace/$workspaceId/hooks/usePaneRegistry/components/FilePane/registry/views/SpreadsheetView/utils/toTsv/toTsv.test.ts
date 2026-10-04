import { expect, test } from "bun:test";
import { toTsv } from "./toTsv";

test("joins cells with tabs and rows with newlines, quoting only fields that need it", () => {
	expect(
		toTsv([
			["Mois", "CA", ""],
			["Jan\tvier", 'dit "ok"', "deux\nlignes"],
		]),
	).toBe('Mois\tCA\t\n"Jan\tvier"\t"dit ""ok"""\t"deux\nlignes"');
});
