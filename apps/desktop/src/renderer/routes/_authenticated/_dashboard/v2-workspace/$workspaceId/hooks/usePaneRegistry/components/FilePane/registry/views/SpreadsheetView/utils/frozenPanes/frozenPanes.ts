import type { FrozenPane } from "../../types";

export const NO_FREEZE: FrozenPane = { rows: 0, cols: 0 };

/** Entries of the workbook archive, as SheetJS returns them with `bookFiles`. */
export type ArchiveFiles = Record<string, { content?: ArrayLike<number> }>;

const HEAD_BYTES = 64 * 1024;
const FROZEN_STATES = new Set(["frozen", "frozenSplit"]);

function attributes(tag: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const match of tag.matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) {
		const [, name, value] = match;
		if (name !== undefined && value !== undefined) result[name] = value;
	}
	return result;
}

function count(value: string | undefined): number {
	const parsed = Math.floor(Number(value));
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** Frozen rows and columns of the first sheet view of a worksheet part. */
export function parseFrozenPane(sheetXml: string): FrozenPane {
	const open = /<(?:\w+:)?sheetView\b[^>]*>/.exec(sheetXml);
	if (!open || open[0].endsWith("/>")) return NO_FREEZE;
	const close = sheetXml.slice(open.index).search(/<\/(?:\w+:)?sheetView>/);
	const view = sheetXml.slice(
		open.index,
		close === -1 ? undefined : open.index + close,
	);
	const pane = /<(?:\w+:)?pane\b[^>]*>/.exec(view);
	if (!pane) return NO_FREEZE;
	const attrs = attributes(pane[0]);
	if (!FROZEN_STATES.has(attrs.state ?? "")) return NO_FREEZE;
	return { rows: count(attrs.ySplit), cols: count(attrs.xSplit) };
}

function decode(content: ArrayLike<number> | undefined, limit?: number) {
	if (!content) return "";
	const bytes =
		content instanceof Uint8Array ? content : Uint8Array.from(content);
	return new TextDecoder().decode(
		limit === undefined ? bytes : bytes.subarray(0, limit),
	);
}

function partPath(target: string): string {
	return target.startsWith("/") ? target.slice(1) : `xl/${target}`;
}

/** Frozen panes of each sheet of an xlsx/xlsm archive, in workbook order. */
export function readFrozenPanes(files: ArchiveFiles | undefined): FrozenPane[] {
	const workbook = decode(files?.["xl/workbook.xml"]?.content);
	if (!files || !workbook) return [];
	const targets = new Map<string, string>();
	const rels = decode(files["xl/_rels/workbook.xml.rels"]?.content);
	for (const tag of rels.match(/<(?:\w+:)?Relationship\b[^>]*>/g) ?? []) {
		const { Id, Target } = attributes(tag);
		if (Id && Target) targets.set(Id, partPath(Target));
	}
	const sheets = workbook.match(/<(?:\w+:)?sheet\b[^>]*>/g) ?? [];
	return sheets.map((tag) => {
		const id = Object.entries(attributes(tag)).find(([name]) =>
			/^(?:\w+:)?id$/.test(name),
		)?.[1];
		const path = id ? targets.get(id) : undefined;
		const head = decode(path ? files[path]?.content : undefined, HEAD_BYTES);
		const dataStart = head.search(/<(?:\w+:)?sheetData\b/);
		return parseFrozenPane(dataStart === -1 ? head : head.slice(0, dataStart));
	});
}
