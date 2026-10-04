import { describe, expect, test } from "bun:test";
import { createDictationSession, dictationEngineFor } from "./dictationSession";

const target = { machineId: "mac", hostUrl: "http://mac", hostName: "My Mac" };
const audio = { uri: "file:///recording.m4a", durationMs: 1000 };

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

describe("dictation engine", () => {
	test("only an enabled target uses file recording, unresolved settings wait", () => {
		expect(dictationEngineFor(null, undefined)).toBe("apple");
		expect(dictationEngineFor(target, undefined)).toBe("waiting");
		expect(dictationEngineFor(target, { enabled: false })).toBe("apple");
		expect(dictationEngineFor(target, { enabled: true })).toBe("file");
	});
});

describe("dictation session", () => {
	test("appends the result and removes audio only after success", async () => {
		const pending = deferred<string>();
		const appended: string[] = [];
		const removed: string[] = [];
		const session = createDictationSession({
			transcribe: () => pending.promise,
			append: (text) => appended.push(text),
			remove: (uri) => removed.push(uri),
		});
		session.accept(audio, target);
		expect(session.getSnapshot().status).toBe("transcribing");
		expect(removed).toEqual([]);
		pending.resolve("hello");
		await pending.promise;
		expect(appended).toEqual(["hello"]);
		expect(removed).toEqual([audio.uri]);
		expect(session.getSnapshot().status).toBe("idle");
	});

	test("retains the audio and original Mac on failure and retries once", async () => {
		const first = deferred<string>();
		const second = deferred<string>();
		const calls: unknown[] = [];
		const removed: string[] = [];
		const appended: string[] = [];
		const session = createDictationSession({
			transcribe: (recording, machine) => {
				calls.push([recording, machine]);
				return calls.length === 1 ? first.promise : second.promise;
			},
			append: (text) => appended.push(text),
			remove: (uri) => removed.push(uri),
		});
		session.accept(audio, target);
		first.reject(new Error("offline"));
		await first.promise.catch(() => {});
		expect(session.getSnapshot().status).toBe("failed");
		expect(removed).toEqual([]);
		const retry = session.retry();
		void session.retry();
		session.accept(
			{ ...audio, uri: "other" },
			{ ...target, machineId: "other" },
		);
		second.resolve("recovered");
		await retry;
		expect(calls).toEqual([
			[audio, target],
			[audio, target],
		]);
		expect(appended).toEqual(["recovered"]);
		expect(removed).toEqual([audio.uri]);
	});

	test("abandon removes a failed recording without appending", async () => {
		const pending = deferred<string>();
		const removed: string[] = [];
		const session = createDictationSession({
			transcribe: () => pending.promise,
			append: () => {
				throw new Error("must not append");
			},
			remove: (uri) => removed.push(uri),
		});
		session.accept(audio, target);
		session.abandon();
		expect(removed).toEqual([]);
		pending.reject(new Error("timeout"));
		await pending.promise.catch(() => {});
		session.abandon();
		expect(removed).toEqual([audio.uri]);
		expect(session.getSnapshot().status).toBe("idle");
	});
});
