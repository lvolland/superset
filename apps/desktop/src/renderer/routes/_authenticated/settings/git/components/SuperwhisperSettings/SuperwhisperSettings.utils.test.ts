import { describe, expect, test } from "bun:test";
import {
	isSuperwhisperHostSupported,
	isSuperwhisperProcedureUnavailable,
} from "./SuperwhisperSettings.utils";

describe("Superwhisper settings visibility", () => {
	test("shows the setting only for a selected macOS host", () => {
		expect(
			isSuperwhisperHostSupported({
				hostId: "local",
				machineId: "local",
				desktopPlatform: "darwin",
				hostPlatform: undefined,
			}),
		).toBe(true);
		expect(
			isSuperwhisperHostSupported({
				hostId: "remote",
				machineId: "local",
				desktopPlatform: "darwin",
				hostPlatform: "linux",
			}),
		).toBe(false);
	});

	test("hides the setting when an older host lacks the procedure", () => {
		expect(
			isSuperwhisperProcedureUnavailable({
				message: 'No procedure found on path "settings.superwhisper.get"',
			}),
		).toBe(true);
		expect(
			isSuperwhisperProcedureUnavailable({ data: { code: "NOT_FOUND" } }),
		).toBe(true);
	});
});
