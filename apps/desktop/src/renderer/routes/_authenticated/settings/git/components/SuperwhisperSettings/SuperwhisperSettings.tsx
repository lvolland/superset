import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { Badge } from "@superset/ui/badge";
import { toast } from "@superset/ui/sonner";
import { Switch } from "@superset/ui/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { SettingsRow } from "../../../components/SettingsRow";
import { isSuperwhisperProcedureUnavailable } from "./SuperwhisperSettings.utils";

interface SuperwhisperSettingsProps {
	hostUrl: string | null;
	hostName: string;
	enabled: boolean;
}

export function SuperwhisperSettings({
	hostUrl,
	hostName,
	enabled,
}: SuperwhisperSettingsProps) {
	const { t } = useLingui();
	const queryClient = useQueryClient();
	const queryKey = ["host-superwhisper", hostUrl] as const;
	const settingsQuery = useQuery({
		queryKey,
		enabled: enabled && hostUrl !== null,
		retry: false,
		queryFn: () => {
			if (!hostUrl) throw new Error("Host service unavailable");
			return getHostServiceClientByUrl(
				hostUrl,
			).settings.superwhisper.get.query();
		},
	});
	const setMutation = useMutation({
		mutationFn: (nextEnabled: boolean) => {
			if (!hostUrl) throw new Error("Host service unavailable");
			return getHostServiceClientByUrl(
				hostUrl,
			).settings.superwhisper.set.mutate({
				enabled: nextEnabled,
			});
		},
		onSuccess: (settings) => {
			queryClient.setQueryData(queryKey, settings);
		},
		onError: (error) => {
			toast.error(
				errorMessage(
					error,
					t({
						message: "Failed to update Superwhisper settings",
					}),
				),
			);
		},
	});

	if (
		!enabled ||
		settingsQuery.isLoading ||
		isSuperwhisperProcedureUnavailable(settingsQuery.error) ||
		!settingsQuery.data
	)
		return null;

	const settings = settingsQuery.data;
	const controlsDisabled = setMutation.isPending;

	return (
		<section className="mt-8 border-t pt-6">
			<h3 className="text-base font-semibold">
				<Trans>Superwhisper</Trans>
			</h3>
			<p className="mt-1 text-sm text-muted-foreground">
				<Trans>Transcribe mobile dictation on {hostName}.</Trans>
			</p>
			<div className="mt-4">
				<SettingsRow
					label={t({
						message: "Use Superwhisper for mobile dictation",
					})}
					hint={t({
						message:
							"Set the model and language for the Superset mode in Superwhisper.",
					})}
					htmlFor="superwhisper-enabled"
				>
					<Switch
						id="superwhisper-enabled"
						checked={settings.enabled}
						disabled={controlsDisabled}
						onCheckedChange={(nextEnabled) => setMutation.mutate(nextEnabled)}
					/>
				</SettingsRow>
				<SettingsRow
					label={t({
						message: "Superwhisper status",
					})}
				>
					<div className="flex flex-wrap justify-end gap-2">
						<Badge variant={settings.installed ? "secondary" : "outline"}>
							{settings.installed ? (
								<Trans>Installed</Trans>
							) : (
								<Trans>Install Superwhisper</Trans>
							)}
						</Badge>
						<Badge variant={settings.modeReady ? "secondary" : "outline"}>
							{settings.modeReady ? (
								<Trans>Superset mode ready</Trans>
							) : (
								<Trans>Superset mode needs setup</Trans>
							)}
						</Badge>
					</div>
				</SettingsRow>
			</div>
		</section>
	);
}
