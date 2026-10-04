import { isMissingProcedureError } from "renderer/lib/isMissingProcedureError";

interface SuperwhisperHostPlatform {
	hostId: string | null;
	machineId: string | null;
	desktopPlatform: string | undefined;
	hostPlatform: string | undefined;
}

export function isSuperwhisperHostSupported({
	hostId,
	machineId,
	desktopPlatform,
	hostPlatform,
}: SuperwhisperHostPlatform): boolean {
	if (hostId === machineId) return desktopPlatform === "darwin";
	return hostPlatform === "darwin";
}

export function isSuperwhisperProcedureUnavailable(error: unknown): boolean {
	if (isMissingProcedureError(error)) return true;
	if (!error || typeof error !== "object") return false;
	return (error as { data?: { code?: unknown } }).data?.code === "NOT_FOUND";
}
