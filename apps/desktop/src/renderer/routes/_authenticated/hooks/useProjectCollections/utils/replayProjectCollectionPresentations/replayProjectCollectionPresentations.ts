import type { HostTagFoldersResult } from "renderer/hooks/host-projects/useHostTagFolders/useHostTagFolders.utils";
import type { ProjectCollectionPendingPresentation } from "shared/project-collections";
import { isUnsupportedProjectScope } from "../../projectCollectionMutations";

export async function replayProjectCollectionPresentations({
	hosts,
	pending,
	readPending,
	enqueue,
	upsert,
	acknowledge,
	invalidate,
}: {
	hosts: HostTagFoldersResult[];
	pending: readonly ProjectCollectionPendingPresentation[];
	readPending: () => readonly ProjectCollectionPendingPresentation[];
	enqueue: (work: () => Promise<void>) => Promise<void>;
	upsert: (
		host: HostTagFoldersResult,
		row: ProjectCollectionPendingPresentation,
	) => Promise<unknown>;
	acknowledge: (row: ProjectCollectionPendingPresentation) => Promise<unknown>;
	invalidate: (host: HostTagFoldersResult) => void;
}) {
	const touched = new Map<string, HostTagFoldersResult>();
	const failedHosts = new Set<string>();
	const unsupportedHosts = new Set<string>();
	for (const row of pending) {
		const host = hosts.find((host) => host.target.machineId === row.machineId);
		if (
			!host?.target.hostUrl ||
			(host.status !== "ready" && host.status !== "error") ||
			failedHosts.has(row.machineId)
		)
			continue;
		try {
			await enqueue(async () => {
				const latest = readPending().find(
					(entry) => entry.machineId === row.machineId && entry.tag === row.tag,
				);
				if (
					!latest ||
					JSON.stringify(latest.setting) !== JSON.stringify(row.setting)
				)
					return;
				if (unsupportedHosts.has(row.machineId)) {
					await acknowledge(row);
					return;
				}
				try {
					await upsert(host, row);
					touched.set(row.machineId, host);
				} catch (error) {
					const code =
						error && typeof error === "object"
							? (error as { data?: { code?: string } }).data?.code
							: undefined;
					if (!isUnsupportedProjectScope(error) && code !== "BAD_REQUEST") {
						failedHosts.add(row.machineId);
						return;
					}
					unsupportedHosts.add(row.machineId);
				}
				await acknowledge(row);
			});
		} catch {}
	}
	for (const host of touched.values()) invalidate(host);
}

export function withPendingProjectCollectionPresentations(
	hosts: HostTagFoldersResult[],
	pending: readonly ProjectCollectionPendingPresentation[],
): HostTagFoldersResult[] {
	return hosts.map((host) => {
		const entries = pending.filter(
			(row) => row.machineId === host.target.machineId,
		);
		if (!entries.length) return host;
		return {
			...host,
			settings: [
				...host.settings.filter(
					(setting) =>
						!entries.some(
							(row) =>
								setting.scope === row.setting.scope && setting.tag === row.tag,
						),
				),
				...entries.map((row) => row.setting),
			],
		};
	});
}
