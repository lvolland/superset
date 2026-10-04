import { Trans, useLingui } from "@lingui/react/macro";
import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useHostServiceInfo } from "renderer/hooks/host-service/useHostServiceInfo";
import { useHostUrl } from "renderer/hooks/host-service/useHostTargetUrl";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useWorkspaceHostOptions } from "renderer/routes/_authenticated/components/DashboardNewWorkspaceModal/components/DashboardNewWorkspaceForm/components/DevicePicker/hooks/useWorkspaceHostOptions";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import {
	HostSelect,
	type HostSelectOption,
} from "../../../../../components/HostSelect";
import { SuperwhisperControls } from "./components/SuperwhisperControls";
import { isSuperwhisperHostSupported } from "./SuperwhisperSettings.utils";

export function SuperwhisperSettings({ hostId }: { hostId: string | null }) {
	const { t } = useLingui();
	const navigate = useNavigate();
	const { machineId } = useLocalHostService();
	const { currentDeviceName, localHostId, otherHosts } =
		useWorkspaceHostOptions();
	const targetHostId = hostId ?? machineId;
	const targetHostUrl = useHostUrl(hostId);
	const { data: desktopPlatform } = electronTrpc.window.getPlatform.useQuery();
	const hostOptions = useMemo<HostSelectOption[]>(() => {
		const thisDeviceLabel = t({ message: "This device" });
		const options: HostSelectOption[] = [];
		if (localHostId) {
			options.push({
				id: localHostId,
				name: currentDeviceName ?? thisDeviceLabel,
				isLocal: true,
				isOnline: true,
			});
		}
		for (const host of otherHosts) {
			options.push({
				id: host.id,
				name: host.name,
				isLocal: false,
				isOnline: host.isOnline,
			});
		}
		if (targetHostId && !options.some((option) => option.id === targetHostId)) {
			options.push({
				id: targetHostId,
				name: targetHostId === machineId ? thisDeviceLabel : targetHostId,
				isLocal: targetHostId === machineId,
				isOnline: targetHostId === machineId,
			});
		}
		return options;
	}, [currentDeviceName, localHostId, machineId, otherHosts, targetHostId, t]);
	const selectedHost = hostOptions.find((option) => option.id === targetHostId);
	const isHostOnline = selectedHost?.isOnline ?? true;
	const hostInfoQuery = useHostServiceInfo(targetHostUrl, isHostOnline);
	const supportsSuperwhisper = isSuperwhisperHostSupported({
		hostId: targetHostId,
		machineId,
		desktopPlatform,
		hostPlatform: hostInfoQuery.data?.platform,
	});

	const hostPicker =
		hostOptions.length > 1 && targetHostId ? (
			<HostSelect
				value={targetHostId}
				options={hostOptions}
				onValueChange={(nextHostId) => {
					void navigate({
						to: "/settings/connections",
						search: { hostId: nextHostId },
						replace: true,
					});
				}}
			/>
		) : null;

	if (!supportsSuperwhisper) {
		return hostPicker ? (
			<div className="mt-8 flex justify-end">{hostPicker}</div>
		) : null;
	}

	return (
		<section className="mt-8 border-t pt-6">
			<header className="flex items-center justify-between gap-4">
				<h3 className="text-base font-semibold">
					<Trans>Superwhisper</Trans>
				</h3>
				{hostPicker}
			</header>
			<SuperwhisperControls hostUrl={targetHostUrl} enabled={isHostOnline} />
		</section>
	);
}
