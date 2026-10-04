import { describe, expect, it } from "bun:test";
import {
	DictationError,
	SuperwhisperAdapter,
	type SuperwhisperDependencies,
	wavDurationMs,
} from "./superwhisper";

function wav(durationMs = 1000): Buffer {
	const bytes = Math.round(durationMs * 32);
	const value = Buffer.alloc(44 + bytes);
	value.write("RIFF");
	value.writeUInt32LE(36 + bytes, 4);
	value.write("WAVEfmt ", 8);
	value.writeUInt32LE(16, 16);
	value.writeUInt16LE(1, 20);
	value.writeUInt16LE(1, 22);
	value.writeUInt32LE(16_000, 24);
	value.writeUInt32LE(32_000, 28);
	value.writeUInt16LE(2, 32);
	value.writeUInt16LE(16, 34);
	value.write("data", 36);
	value.writeUInt32LE(bytes, 40);
	return value;
}

function fixture(
	options: {
		missingMode?: boolean;
		missingApp?: boolean;
		missingDefault?: boolean;
		timeout?: boolean;
		failOpen?: boolean;
		failRestore?: boolean;
		noLlm?: boolean;
		ambiguous?: boolean;
		activeMode?: string;
	} = {},
) {
	let now = 0;
	let mode = options.activeMode ?? "pro";
	let clipboard = "original clipboard\n";
	let submissions = 0;
	const commands: string[][] = [];
	const files = new Map<string, string | Buffer>();
	files.set("/Applications/superwhisper.app", "");
	files.set(
		"/home/superwhisper/modes/default.json",
		JSON.stringify({
			key: "default",
			name: "Default",
			voiceModelID: "model",
			autoPaste: true,
			scriptEnabled: true,
		}),
	);
	if (!options.missingMode)
		files.set(
			"/home/superwhisper/modes/superset.json",
			JSON.stringify({ key: "superset", name: "Superset", autoPaste: false }),
		);
	if (options.missingApp) files.delete("/Applications/superwhisper.app");
	if (options.missingDefault)
		files.delete("/home/superwhisper/modes/default.json");
	const enoent = () => Object.assign(new Error("missing"), { code: "ENOENT" });
	const deps: SuperwhisperDependencies = {
		platform: "darwin",
		home: "/home",
		temporaryDirectory: "/temp",
		now: () => now,
		sleep: async (ms) => {
			now += ms;
		},
		fs: {
			access: async (path: string) => {
				if (!files.has(path)) throw enoent();
			},
			readFile: async (path: string, encoding?: string) => {
				const value = files.get(path);
				if (value === undefined) throw enoent();
				return encoding ? value.toString() : Buffer.from(value);
			},
			writeFile: async (
				path: string,
				value: string | Buffer,
				config?: { flag?: string },
			) => {
				if (config?.flag === "wx" && files.has(path))
					throw Object.assign(new Error("exists"), { code: "EEXIST" });
				files.set(path, value);
			},
			mkdir: async () => {},
			mkdtemp: async () => "/temp/job",
			readdir: async () => [
				...new Set(
					[...files.keys()]
						.filter((p) => p.startsWith("/home/superwhisper/recordings/"))
						.map((p) => p.split("/")[4]),
				),
			],
			rm: async (path: string) => {
				for (const key of files.keys())
					if (key.startsWith(`${path}/`)) files.delete(key);
			},
		} as unknown as SuperwhisperDependencies["fs"],
		run: async (command, args, config) => {
			commands.push([command, ...args]);
			if (command.endsWith("afconvert")) {
				files.set(args.at(-1) as string, wav());
				return "";
			}
			if (command.endsWith("defaults"))
				return args.at(-1) === "activeModeKey" ? mode : "/home";
			if (command.endsWith("pbpaste")) return clipboard;
			if (command.endsWith("pbcopy")) {
				clipboard = config.input ?? "";
				return "";
			}
			if (command.endsWith("open") && args[1]?.startsWith("superwhisper://")) {
				const next = new URL(args[1]).searchParams.get("key") as string;
				if (options.failRestore && next === "pro")
					throw new Error("restore failed");
				mode = next;
				return "";
			}
			if (command.endsWith("open") && args.includes("-a")) {
				expect(mode).toBe("superset");
				expect(
					JSON.parse(
						files.get("/home/superwhisper/modes/superset.json") as string,
					).autoPaste,
				).toBe(false);
				if (options.failOpen) throw new Error("open failed");
				submissions++;
				clipboard = "transcription";
				if (!options.timeout) {
					files.set(
						`/home/superwhisper/recordings/${submissions}/meta.json`,
						JSON.stringify({
							modeName: "Superset",
							duration: 1000,
							llmResult: options.noLlm ? " " : ` processed ${submissions} `,
							result: "raw text",
						}),
					);
					if (options.ambiguous)
						files.set(
							"/home/superwhisper/recordings/extra/meta.json",
							JSON.stringify({
								modeName: "Superset",
								duration: 1000,
								result: "wrong",
							}),
						);
				}
			}
			return "";
		},
	};
	return {
		deps,
		adapter: new SuperwhisperAdapter(deps),
		files,
		commands,
		mode: () => mode,
		clipboard: () => clipboard,
		now: () => now,
	};
}

const audio = Buffer.from("audio");

describe("SuperwhisperAdapter", () => {
	it("returns processed text and restores mode and exact clipboard", async () => {
		const f = fixture();
		expect(await f.adapter.transcribe(audio, "audio/mp4")).toEqual({
			text: "processed 1",
		});
		expect(f.mode()).toBe("pro");
		expect(f.clipboard()).toBe("original clipboard\n");
		expect(
			f.commands
				.filter((c) => c[0]?.endsWith("open"))
				.every((c) => c[1] === "-g"),
		).toBe(true);
		expect([...f.files.keys()].some((p) => p.startsWith("/temp/job/"))).toBe(
			false,
		);
	});
	it("uses UTF-8 for clipboard commands and preserves multilingual text", async () => {
		const f = fixture();
		const run = f.deps.run;
		const text = "Été à Tokyo 東京\n";
		let copied = "";
		f.deps.run = async (command, args, options) => {
			if (command.endsWith("pbpaste") || command.endsWith("pbcopy")) {
				expect(options).toMatchObject({
					env: { LC_ALL: "en_US.UTF-8", PATH: process.env.PATH },
				});
				if (command.endsWith("pbpaste")) return text;
				copied = options.input ?? "";
			}
			return run(command, args, options);
		};
		await f.adapter.transcribe(audio, "audio/mp4");
		expect(copied).toBe(text);
	});
	it.each([
		false,
		true,
	])("restores default when Superset was already active (timeout: %s)", async (timeout) => {
		const f = fixture({ activeMode: "superset", timeout });
		if (timeout) {
			await expect(
				f.adapter.transcribe(audio, "audio/mp4"),
			).rejects.toMatchObject({ kind: "TIMEOUT" });
		} else {
			await f.adapter.transcribe(audio, "audio/mp4");
		}
		expect(f.mode()).toBe("default");
	});
	it("passes integer command timeouts with a fractional monotonic clock", async () => {
		const f = fixture();
		let tick = 0;
		f.deps.now = () => (tick += 0.25);
		const run = f.deps.run;
		f.deps.run = async (command, args, options) => {
			if (!Number.isInteger(options.timeoutMs))
				throw new RangeError("Invalid timeout");
			return run(command, args, options);
		};
		expect(await f.adapter.transcribe(audio, "audio/mp4")).toEqual({
			text: "processed 1",
		});
	});
	it("uses result when llmResult is empty", async () => {
		const f = fixture({ noLlm: true });
		expect(await f.adapter.transcribe(audio, "audio/mp4")).toEqual({
			text: "raw text",
		});
	});
	it("creates only a safe dedicated mode and preserves default", async () => {
		const f = fixture({ missingMode: true });
		const before = f.files.get("/home/superwhisper/modes/default.json");
		await f.adapter.ensureMode();
		expect(
			JSON.parse(
				f.files.get("/home/superwhisper/modes/superset.json") as string,
			),
		).toMatchObject({
			name: "Superset",
			key: "superset",
			autoPaste: false,
			voiceModelID: "model",
			scriptEnabled: false,
			realtimeOutput: false,
		});
		expect(f.files.get("/home/superwhisper/modes/default.json")).toBe(before);
	});
	it("recreates a removed mode before submitting audio", async () => {
		const f = fixture({ missingMode: true });
		expect(await f.adapter.transcribe(audio, "audio/mp4")).toEqual({
			text: "processed 1",
		});
	});
	it("refuses unsafe existing modes without overwriting them", async () => {
		const f = fixture();
		const unsafe = JSON.stringify({
			key: "superset",
			name: "Superset",
			autoPaste: true,
		});
		f.files.set("/home/superwhisper/modes/superset.json", unsafe);
		await expect(
			f.adapter.transcribe(audio, "audio/mp4"),
		).rejects.toMatchObject({ kind: "MODE_NOT_READY" });
		expect(f.commands).toHaveLength(0);
		expect(f.files.get("/home/superwhisper/modes/superset.json")).toBe(unsafe);
	});
	it("reports unavailable apps and unsupported platforms", async () => {
		const f = fixture({ missingApp: true });
		await expect(f.adapter.ensureMode()).rejects.toMatchObject({
			kind: "UNAVAILABLE",
		});
		const other = new SuperwhisperAdapter({ ...f.deps, platform: "linux" });
		expect(await other.status()).toEqual({
			installed: false,
			modeReady: false,
		});
	});
	it("reports a missing default mode", async () => {
		await expect(
			fixture({ missingMode: true, missingDefault: true }).adapter.ensureMode(),
		).rejects.toMatchObject({ kind: "MODE_NOT_READY" });
	});
	it("times out without real waiting and restores both states", async () => {
		const f = fixture({ timeout: true });
		await expect(
			f.adapter.transcribe(audio, "audio/mp4"),
		).rejects.toMatchObject({ kind: "TIMEOUT" });
		expect(f.now()).toBe(30_000);
		expect(f.mode()).toBe("pro");
		expect(f.clipboard()).toBe("original clipboard\n");
	});
	it("restores mode and clipboard on failed submission", async () => {
		const f = fixture({ failOpen: true });
		await expect(
			f.adapter.transcribe(audio, "audio/mp4"),
		).rejects.toMatchObject({ kind: "TRANSCRIPTION_FAILED" });
		expect(f.mode()).toBe("pro");
		expect(f.clipboard()).toBe("original clipboard\n");
	});
	it("still restores clipboard when mode restoration fails", async () => {
		const f = fixture({ failRestore: true });
		await expect(
			f.adapter.transcribe(audio, "audio/mp4"),
		).rejects.toMatchObject({ kind: "RESTORE_FAILED" });
		expect(f.clipboard()).toBe("original clipboard\n");
	});
	it("serializes overlapping requests and ignores prior recordings", async () => {
		const f = fixture();
		expect(
			await Promise.all([
				f.adapter.transcribe(audio, "audio/mp4"),
				f.adapter.transcribe(audio, "audio/mp4"),
			]),
		).toEqual([{ text: "processed 1" }, { text: "processed 2" }]);
		const opens = f.commands.filter((c) => c[0]?.endsWith("open"));
		expect(opens.map((c) => c[2])).toEqual([
			"superwhisper://mode?key=superset",
			"-a",
			"superwhisper://mode?key=pro",
			"superwhisper://mode?key=superset",
			"-a",
			"superwhisper://mode?key=pro",
		]);
	});
	it("does not return ambiguous recordings", async () => {
		const f = fixture({ ambiguous: true });
		await expect(
			f.adapter.transcribe(audio, "audio/mp4"),
		).rejects.toMatchObject({ kind: "TRANSCRIPTION_FAILED" });
		expect(f.mode()).toBe("pro");
	});
	it("ignores recordings with another mode or duration", async () => {
		const f = fixture({ timeout: true });
		const original = f.deps.run;
		f.deps.run = async (command, args, config) => {
			const result = await original(command, args, config);
			if (args.includes("-a")) {
				f.files.set(
					"/home/superwhisper/recordings/wrong-mode/meta.json",
					JSON.stringify({
						modeName: "Default",
						duration: 1000,
						result: "wrong",
					}),
				);
				f.files.set(
					"/home/superwhisper/recordings/wrong-duration/meta.json",
					JSON.stringify({
						modeName: "Superset",
						duration: 2000,
						result: "wrong",
					}),
				);
			}
			return result;
		};
		await expect(
			f.adapter.transcribe(audio, "audio/mp4"),
		).rejects.toMatchObject({ kind: "TIMEOUT" });
	});
});

it("accepts the extensible PCM WAV format emitted by macOS afconvert", () => {
	const pcm = wav(1000);
	const extension = Buffer.from(
		"16001000040000000100000000001000800000aa00389b71",
		"hex",
	);
	const converted = Buffer.concat([
		pcm.subarray(0, 36),
		extension,
		pcm.subarray(36),
	]);
	converted.writeUInt32LE(converted.length - 8, 4);
	converted.writeUInt32LE(40, 16);
	converted.writeUInt16LE(0xfffe, 20);
	expect(wavDurationMs(converted)).toBe(1000);
});

it("validates converted WAV duration and malformed audio", () => {
	expect(wavDurationMs(wav(2300))).toBe(2300);
	expect(() => wavDurationMs(Buffer.from("invalid"))).toThrow(DictationError);
	expect(() => wavDurationMs(wav().subarray(0, 45))).toThrow(DictationError);
});
