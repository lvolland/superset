import { expect, test } from "bun:test";
import { BLOCK_ROWS, RowBlockCache } from "./RowBlockCache";

test("fetches each block once and serves its cells after load", async () => {
	const requests: Array<[number, number]> = [];
	let loads = 0;
	const cache = new RowBlockCache(
		async (start, end) => {
			requests.push([start, end]);
			return Array.from({ length: end - start }, (_, i) => [
				{ text: String(start + i), kind: "number" as const },
			]);
		},
		() => {
			loads += 1;
		},
	);
	cache.ensure(0, BLOCK_ROWS + 1);
	cache.ensure(10, 20);
	expect(cache.getCell(5, 0)).toBeUndefined();
	await Promise.resolve();
	expect(requests).toEqual([
		[0, BLOCK_ROWS],
		[BLOCK_ROWS, BLOCK_ROWS * 2],
	]);
	expect(loads).toBe(2);
	expect(cache.getCell(BLOCK_ROWS + 1, 0)?.text).toBe(String(BLOCK_ROWS + 1));
	expect(cache.getCell(5, 3)).toBeNull();
});
