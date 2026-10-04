import type { GridCell } from "../../types";

type Rows = (GridCell | null)[][];

export const BLOCK_ROWS = 256;
const MAX_BLOCKS = 48;

/** Rows of one sheet fetched from the worker in blocks, most recent first. */
export class RowBlockCache {
	private blocks = new Map<number, Rows>();
	private pending = new Set<number>();
	private disposed = false;

	constructor(
		private readonly fetchRows: (start: number, end: number) => Promise<Rows>,
		private readonly onLoad: () => void,
	) {}

	/** undefined while the row's block is still loading. */
	getCell(row: number, col: number): GridCell | null | undefined {
		const block = this.blocks.get(Math.floor(row / BLOCK_ROWS));
		if (!block) return undefined;
		return block[row % BLOCK_ROWS]?.[col] ?? null;
	}

	ensure(startRow: number, endRow: number): void {
		const first = Math.floor(Math.max(0, startRow) / BLOCK_ROWS);
		const last = Math.floor(Math.max(0, endRow) / BLOCK_ROWS);
		for (let index = first; index <= last; index += 1) {
			const block = this.blocks.get(index);
			if (block) {
				this.blocks.delete(index);
				this.blocks.set(index, block);
				continue;
			}
			if (this.pending.has(index)) continue;
			this.pending.add(index);
			this.fetchRows(index * BLOCK_ROWS, (index + 1) * BLOCK_ROWS).then(
				(rows) => {
					this.pending.delete(index);
					if (this.disposed) return;
					this.blocks.set(index, rows);
					this.evict(first, last);
					this.onLoad();
				},
				() => {
					this.pending.delete(index);
				},
			);
		}
	}

	dispose(): void {
		this.disposed = true;
		this.blocks.clear();
	}

	private evict(keepFirst: number, keepLast: number): void {
		for (const index of this.blocks.keys()) {
			if (this.blocks.size <= MAX_BLOCKS) return;
			if (index >= keepFirst && index <= keepLast) continue;
			this.blocks.delete(index);
		}
	}
}
