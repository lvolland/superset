import { expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

let online = true;
let cloudWorkspaces = false;
mock.module("posthog-js/react", () => ({
	useFeatureFlagEnabled: () => cloudWorkspaces,
}));
mock.module("renderer/hooks/useIsV2CloudEnabled", () => ({
	useIsV2CloudEnabled: () => true,
}));
mock.module("renderer/stores/settings-state", () => ({
	useSettingsSearchQuery: () => "",
}));
mock.module("renderer/lib/cloud-trpc", () => ({
	cloudTrpc: {
		useUtils: () => ({}),
		githubUser: {
			get: {
				useQuery: () => ({ data: { connection: null }, isPending: false }),
			},
			connect: { useMutation: () => ({ isPending: false }) },
			disconnect: { useMutation: () => ({ isPending: false }) },
		},
	},
}));
mock.module("renderer/lib/host-service-client", () => ({
	getHostServiceClientByUrl: () => ({
		settings: {
			superwhisper: {
				get: { query: () => new Promise(() => {}) },
				set: { mutate: async () => settings },
			},
		},
	}),
}));
mock.module("@tanstack/react-router", () => ({ useNavigate: () => () => {} }));
mock.module("renderer/hooks/host-service/useHostServiceInfo", () => ({
	useHostServiceInfo: () => ({ data: { platform: "darwin" } }),
}));
mock.module("renderer/hooks/host-service/useHostTargetUrl", () => ({
	useHostUrl: () => "http://remote",
}));
mock.module("renderer/lib/electron-trpc", () => ({
	electronTrpc: {
		window: { getPlatform: { useQuery: () => ({ data: "darwin" }) } },
	},
}));
mock.module(
	"renderer/routes/_authenticated/providers/LocalHostServiceProvider",
	() => ({
		useLocalHostService: () => ({ machineId: "local" }),
	}),
);
mock.module(
	"renderer/routes/_authenticated/components/DashboardNewWorkspaceModal/components/DashboardNewWorkspaceForm/components/DevicePicker/hooks/useWorkspaceHostOptions",
	() => ({
		useWorkspaceHostOptions: () => ({
			currentDeviceName: "Local Mac",
			localHostId: "local",
			otherHosts: [{ id: "remote", name: "Remote Mac", isOnline: online }],
		}),
	}),
);

const { SuperwhisperSettings } = await import("../SuperwhisperSettings");
const { ConnectionsSettings } = await import("../../../ConnectionsSettings");
const settings = { enabled: true, installed: true, modeReady: true };
const queryKey = ["host-superwhisper", "http://remote"];

function renderSettings({
	data,
	error,
	isOnline = true,
	fullPage = false,
}: {
	data?: typeof settings;
	error?: Error;
	isOnline?: boolean;
	fullPage?: boolean;
} = {}) {
	online = isOnline;
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: Infinity } },
	});
	if (data) client.setQueryData(queryKey, data);
	if (error)
		client
			.getQueryCache()
			.build(client, { queryKey })
			.setState({ status: "error", error, fetchStatus: "idle" });
	try {
		return renderToStaticMarkup(
			<QueryClientProvider client={client}>
				{fullPage ? (
					<ConnectionsSettings hostId="remote" />
				) : (
					<SuperwhisperSettings hostId="remote" />
				)}
			</QueryClientProvider>,
		);
	} finally {
		client.clear();
	}
}

test("keeps dictation controls but hides GitHub without cloud workspaces", () => {
	cloudWorkspaces = false;
	const html = renderSettings({ data: settings, fullPage: true });
	expect(html).toContain('id="superwhisper-enabled"');
	expect(html).not.toContain("GitHub");
	cloudWorkspaces = true;
	expect(renderSettings({ data: settings, fullPage: true })).toContain(
		"GitHub",
	);
	cloudWorkspaces = false;
});

test("hides the full section while settings load", () => {
	expect(renderSettings()).toBe("");
});
test("hides the full section for an old host", () => {
	const error = Object.assign(new Error("Not found"), {
		data: { code: "NOT_FOUND" },
	});
	expect(renderSettings({ error })).toBe("");
});
test("hides the full section when the host is offline despite cached settings", () => {
	expect(renderSettings({ data: settings, isOnline: false })).toBe("");
});
test("hides the full section after a failed settings refresh", () => {
	expect(renderSettings({ data: settings, error: new Error("offline") })).toBe(
		"",
	);
});
test("shows the full section and Mac selector after a successful query", () => {
	const html = renderSettings({ data: settings });
	expect(html).toContain("<section");
	expect(html).toContain("Superwhisper</h3>");
	expect(html).toContain("Remote Mac");
	expect(html).toContain('id="superwhisper-enabled"');
});
