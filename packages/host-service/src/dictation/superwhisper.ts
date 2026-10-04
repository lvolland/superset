import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export type DictationErrorKind =
	| "DISABLED"
	| "UNAVAILABLE"
	| "MODE_NOT_READY"
	| "INVALID_AUDIO"
	| "TIMEOUT"
	| "TRANSCRIPTION_FAILED"
	| "RESTORE_FAILED";

export class DictationError extends Error {
	constructor(
		public readonly kind: DictationErrorKind,
		message: string,
	) {
		super(message);
	}
}

export interface SuperwhisperDependencies {
	platform: string;
	home: string;
	temporaryDirectory: string;
	fs: Pick<
		typeof fs,
		"access" | "readFile" | "writeFile" | "mkdir" | "mkdtemp" | "readdir" | "rm"
	>;
	run(
		command: string,
		args: string[],
		options: { timeoutMs: number; input?: string; env?: NodeJS.ProcessEnv },
	): Promise<string>;
	now(): number;
	sleep(ms: number): Promise<void>;
}

export const systemSuperwhisperDependencies: SuperwhisperDependencies = {
	platform: process.platform,
	home: homedir(),
	temporaryDirectory: tmpdir(),
	fs,
	now: () => performance.now(),
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	run: (command, args, { timeoutMs, input, env }) =>
		new Promise((resolve, reject) => {
			const child = execFile(
				command,
				args,
				{
					timeout: timeoutMs,
					killSignal: "SIGKILL",
					maxBuffer: 1024 * 1024,
					env,
				},
				(error, stdout) => {
					if (error) reject(error);
					else resolve(stdout);
				},
			);
			child.stdin?.on("error", reject);
			child.stdin?.end(input);
		}),
};

const APP = "/Applications/superwhisper.app";
const DOMAIN = "com.superduper.superwhisper";
const TIMEOUT_MS = 30_000;
const RESTORE_TIMEOUT_MS = 2_000;

function modeIsSafe(value: unknown): boolean {
	if (!value || typeof value !== "object") return false;
	const mode = value as Record<string, unknown>;
	return (
		mode.key === "superset" &&
		mode.name === "Superset" &&
		mode.autoPaste === false &&
		mode.realtimeOutput !== true &&
		mode.scriptEnabled !== true
	);
}

export function wavDurationMs(wav: Buffer): number {
	if (
		wav.length < 12 ||
		wav.toString("ascii", 0, 4) !== "RIFF" ||
		wav.toString("ascii", 8, 12) !== "WAVE"
	) {
		throw new DictationError(
			"INVALID_AUDIO",
			"Audio conversion did not produce a WAV file",
		);
	}
	let byteRate = 0;
	let dataBytes = 0;
	for (let offset = 12; offset + 8 <= wav.length; ) {
		const size = wav.readUInt32LE(offset + 4);
		const start = offset + 8;
		if (start + size > wav.length)
			throw new DictationError("INVALID_AUDIO", "WAV audio is truncated");
		const kind = wav.toString("ascii", offset, offset + 4);
		if (kind === "fmt " && size >= 16) {
			const format = wav.readUInt16LE(start);
			const extensiblePcm =
				format === 0xfffe &&
				size >= 40 &&
				wav.readUInt16LE(start + 18) === 16 &&
				wav
					.subarray(start + 24, start + 40)
					.equals(Buffer.from("0100000000001000800000aa00389b71", "hex"));
			if (
				(format !== 1 && !extensiblePcm) ||
				wav.readUInt16LE(start + 2) !== 1 ||
				wav.readUInt32LE(start + 4) !== 16_000 ||
				wav.readUInt16LE(start + 14) !== 16
			) {
				throw new DictationError(
					"INVALID_AUDIO",
					"Audio must be 16 kHz mono PCM",
				);
			}
			byteRate = wav.readUInt32LE(start + 8);
		}
		if (kind === "data") dataBytes += size;
		offset = start + size + (size % 2);
	}
	if (byteRate !== 32_000 || !dataBytes)
		throw new DictationError("INVALID_AUDIO", "Audio is empty or invalid");
	return (dataBytes / byteRate) * 1000;
}

export class SuperwhisperAdapter {
	private queue: Promise<unknown> = Promise.resolve();
	private readonly modePath: string;

	constructor(private readonly deps: SuperwhisperDependencies) {
		this.modePath = join(deps.home, "superwhisper", "modes", "superset.json");
	}

	private async exists(path: string): Promise<boolean> {
		try {
			await this.deps.fs.access(path);
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
			throw error;
		}
	}

	async status(): Promise<{ installed: boolean; modeReady: boolean }> {
		if (this.deps.platform !== "darwin")
			return { installed: false, modeReady: false };
		const installed = await this.exists(APP);
		let modeReady = false;
		try {
			modeReady = modeIsSafe(
				JSON.parse(await this.deps.fs.readFile(this.modePath, "utf8")),
			);
		} catch (error) {
			if (
				!(error instanceof SyntaxError) &&
				(error as NodeJS.ErrnoException).code !== "ENOENT"
			)
				throw error;
		}
		return { installed, modeReady };
	}

	async ensureMode(): Promise<void> {
		if (!(await this.status()).installed)
			throw new DictationError(
				"UNAVAILABLE",
				"Superwhisper is not installed on this Mac",
			);
		if (!(await this.exists(this.modePath))) {
			try {
				const source: unknown = JSON.parse(
					await this.deps.fs.readFile(
						join(this.deps.home, "superwhisper", "modes", "default.json"),
						"utf8",
					),
				);
				if (!source || typeof source !== "object" || Array.isArray(source))
					throw new Error("Invalid default mode");
				await this.deps.fs.mkdir(
					join(this.deps.home, "superwhisper", "modes"),
					{ recursive: true },
				);
				await this.deps.fs.writeFile(
					this.modePath,
					JSON.stringify(
						{
							...source,
							name: "Superset",
							key: "superset",
							autoPaste: false,
							realtimeOutput: false,
							scriptEnabled: false,
						},
						null,
						2,
					),
					{ flag: "wx", mode: 0o600 },
				);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST")
					throw new DictationError(
						"MODE_NOT_READY",
						"Cannot create the Superset mode from the Superwhisper default mode",
					);
			}
		}
		if (!(await this.status()).modeReady)
			throw new DictationError(
				"MODE_NOT_READY",
				"The Superset mode must disable automatic paste, realtime output and scripts",
			);
	}

	transcribe(audio: Buffer, mediaType: string): Promise<{ text: string }> {
		const queuedAt = this.deps.now();
		const job = this.queue.then(() =>
			this.transcribeOnce(audio, mediaType, queuedAt + TIMEOUT_MS),
		);
		this.queue = job.catch(() => {});
		return job;
	}

	private async transcribeOnce(
		audio: Buffer,
		mediaType: string,
		deadline: number,
	): Promise<{ text: string }> {
		const remaining = () => {
			const ms = deadline - this.deps.now();
			if (ms <= 0)
				throw new DictationError(
					"TIMEOUT",
					"Superwhisper did not finish within 30 seconds. Check that file transcription is available with your license",
				);
			return Math.ceil(ms);
		};
		const command = async (name: string, args: string[]) => {
			try {
				return await this.deps.run(name, args, {
					timeoutMs: remaining(),
					...(name === "/usr/bin/pbpaste" && {
						env: { ...process.env, LC_ALL: "en_US.UTF-8" },
					}),
				});
			} catch (error) {
				remaining();
				throw error;
			}
		};
		const pause = async () => {
			await this.deps.sleep(Math.min(100, remaining()));
			remaining();
		};
		remaining();
		await this.ensureMode();
		let directory: string | undefined;
		let originalMode: string | undefined;
		let clipboard: string | undefined;
		let modeChanged = false;
		let textResult = "";
		let failure: unknown;
		let restoreFailed = false;
		try {
			directory = await this.deps.fs.mkdtemp(
				join(this.deps.temporaryDirectory, "superset-dictation-"),
			);
			const input = join(
				directory,
				mediaType === "audio/wav" ? "audio.wav" : "audio.m4a",
			);
			const wav = join(directory, "converted.wav");
			await this.deps.fs.writeFile(input, audio, { mode: 0o600 });
			try {
				await command("/usr/bin/afconvert", [
					"-f",
					"WAVE",
					"-d",
					"LEI16@16000",
					"-c",
					"1",
					input,
					wav,
				]);
			} catch (error) {
				if (error instanceof DictationError) throw error;
				throw new DictationError(
					"INVALID_AUDIO",
					"Cannot decode the recorded audio",
				);
			}
			const durationMs = wavDurationMs(await this.deps.fs.readFile(wav));
			if (durationMs > 300_000)
				throw new DictationError(
					"INVALID_AUDIO",
					"Dictation cannot exceed five minutes",
				);
			let appFolder: string;
			try {
				appFolder =
					(
						await command("/usr/bin/defaults", [
							"read",
							DOMAIN,
							"appFolderDirectory",
						])
					).trim() || this.deps.home;
			} catch (error) {
				if (error instanceof DictationError) throw error;
				appFolder = this.deps.home;
			}
			const recordings = join(appFolder, "superwhisper", "recordings");
			originalMode = (
				await command("/usr/bin/defaults", ["read", DOMAIN, "activeModeKey"])
			).trim();
			if (!originalMode)
				throw new DictationError(
					"MODE_NOT_READY",
					"Cannot read the active Superwhisper mode",
				);
			if (originalMode === "superset") originalMode = "default";
			modeChanged = true;
			await command("/usr/bin/open", [
				"-g",
				"superwhisper://mode?key=superset",
			]);
			while (
				(
					await command("/usr/bin/defaults", ["read", DOMAIN, "activeModeKey"])
				).trim() !== "superset"
			)
				await pause();
			clipboard = await command("/usr/bin/pbpaste", []);
			await this.ensureMode();
			const previous = new Set(await this.listRecordings(recordings));
			await command("/usr/bin/open", ["-g", "-a", APP, wav]);
			while (true) {
				remaining();
				const matches: Record<string, unknown>[] = [];
				for (const id of await this.listRecordings(recordings)) {
					if (previous.has(id)) continue;
					try {
						const meta: unknown = JSON.parse(
							await this.deps.fs.readFile(
								join(recordings, id, "meta.json"),
								"utf8",
							),
						);
						if (!meta || typeof meta !== "object") continue;
						const value = meta as Record<string, unknown>;
						if (
							value.modeName === "Superset" &&
							typeof value.duration === "number" &&
							Math.abs(value.duration - durationMs) <=
								Math.max(150, durationMs * 0.02)
						)
							matches.push(value);
					} catch (error) {
						if (
							!(error instanceof SyntaxError) &&
							(error as NodeJS.ErrnoException).code !== "ENOENT"
						)
							throw error;
					}
				}
				if (matches.length > 1)
					throw new DictationError(
						"TRANSCRIPTION_FAILED",
						"More than one Superwhisper recording matches this dictation",
					);
				const meta = matches[0];
				const text =
					typeof meta?.llmResult === "string" && meta.llmResult.trim()
						? meta.llmResult
						: meta?.result;
				if (typeof text === "string" && text.trim()) {
					textResult = text.trim();
					break;
				}
				await pause();
			}
		} catch (error) {
			failure =
				error instanceof DictationError
					? error
					: new DictationError(
							"TRANSCRIPTION_FAILED",
							"Superwhisper could not transcribe this recording",
						);
		} finally {
			if (modeChanged && originalMode) {
				try {
					await this.restoreMode(originalMode);
				} catch {
					restoreFailed = true;
				}
			}
			if (clipboard !== undefined) {
				try {
					await this.deps.run("/usr/bin/pbcopy", [], {
						timeoutMs: RESTORE_TIMEOUT_MS,
						input: clipboard,
						env: { ...process.env, LC_ALL: "en_US.UTF-8" },
					});
				} catch {
					restoreFailed = true;
				}
			}
			try {
				if (directory)
					await this.deps.fs.rm(directory, { recursive: true, force: true });
			} catch {
				restoreFailed = true;
			}
		}
		if (restoreFailed)
			throw new DictationError(
				"RESTORE_FAILED",
				"Could not restore the Superwhisper mode or clipboard after dictation",
			);
		if (failure) throw failure;
		return { text: textResult };
	}

	private async restoreMode(originalMode: string): Promise<void> {
		const deadline = this.deps.now() + RESTORE_TIMEOUT_MS;
		await this.deps.run(
			"/usr/bin/open",
			["-g", `superwhisper://mode?key=${encodeURIComponent(originalMode)}`],
			{ timeoutMs: RESTORE_TIMEOUT_MS },
		);
		while (true) {
			const ms = deadline - this.deps.now();
			if (ms <= 0) throw new Error("Mode restore timed out");
			if (
				(
					await this.deps.run(
						"/usr/bin/defaults",
						["read", DOMAIN, "activeModeKey"],
						{ timeoutMs: Math.ceil(ms) },
					)
				).trim() === originalMode
			)
				return;
			await this.deps.sleep(Math.min(100, ms));
		}
	}

	private async listRecordings(path: string): Promise<string[]> {
		try {
			return await this.deps.fs.readdir(path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw error;
		}
	}
}

export const superwhisper = new SuperwhisperAdapter(
	systemSuperwhisperDependencies,
);
