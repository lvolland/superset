import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type { ProjectCollectionPlacement } from "shared/project-collections";

const registered = GlobalRegistrator.isRegistered;
if (!registered) GlobalRegistrator.register();
(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const target = {
	organizationId: "org",
	machineId: "local",
	hostUrl: "local",
	isLocal: true,
};
const { normalizeHostProjectRow } = await import(
	"renderer/hooks/host-projects/useHostProjects/useHostProjects.utils"
);
const projectHosts = [
	{
		target,
		reachable: true,
		rows: [] as ReturnType<typeof normalizeHostProjectRow>[],
	},
];
let sidebarProjects: Array<{
	projectId: string;
	tabOrder: number;
	isHidden: boolean;
}> = [];
const folderHosts = [
	{
		target,
		status: "ready",
		settings: [
			{
				scope: "projects",
				tag: "team",
				displayName: "Team",
				color: null,
				tabOrder: 0,
			},
			{
				scope: "projects",
				tag: "other",
				displayName: "Other",
				color: null,
				tabOrder: 1,
			},
		],
	},
];
let placements: ProjectCollectionPlacement[] = [
	{ key: "projects:team", kind: "collection", tabOrder: 0, isCollapsed: true },
	{
		key: "projects:other",
		kind: "collection",
		tabOrder: 1,
		isCollapsed: false,
	},
];
let update: (rows: ProjectCollectionPlacement[]) => void;
let release: () => void;
let reconcileStarted = false;
const reconcileGate = new Promise<void>((resolve) => {
	release = resolve;
});
const localInvalidations: string[] = [];
const write = {
	mutateAsync: async ({ rows }: { rows: ProjectCollectionPlacement[] }) => {
		placements = rows;
	},
};
const reconcile = {
	mutateAsync: async () => {
		reconcileStarted = true;
		await reconcileGate;
	},
};
const listUtils = {
	cancel: async () => {},
	getData: () => placements,
	setData: (_scope: unknown, rows: ProjectCollectionPlacement[]) => {
		placements = rows;
		update(rows);
	},
	invalidate: async () => {
		localInvalidations.push("placements");
		update(placements);
	},
};
const utils = { projectCollections: { list: listUtils } };
mock.module("@tanstack/react-db", () => ({
	useLiveQuery: () => ({ data: sidebarProjects }),
}));
mock.module("renderer/hooks/host-projects/useHostProjects", () => ({
	useHostProjects: () => ({
		projects: projectHosts.flatMap((host) => host.rows),
		hostResults: projectHosts,
		isReady: true,
	}),
}));
mock.module("renderer/hooks/host-projects/useHostTagFolders", () => ({
	useHostTagFolders: () => ({ hostResults: folderHosts, isReady: true }),
}));
mock.module("renderer/hooks/useV2UserPreferences", () => ({
	useV2UserPreferences: () => ({
		preferences: {
			sidebarProjectSortMode: "manual",
			hideEmptyProjectCollections: false,
		},
		setHideEmptyProjectCollections: () => {},
	}),
}));
mock.module("renderer/lib/auth-client", () => ({
	authClient: { useSession: () => ({ data: { user: { id: "alice" } } }) },
}));
mock.module(
	"renderer/routes/_authenticated/providers/CollectionsProvider",
	() => ({ useCollections: () => ({}) }),
);
mock.module(
	"renderer/routes/_authenticated/providers/HostWorkspacesProvider",
	() => ({ useHostWorkspaces: () => ({ workspaces: [], isReady: true }) }),
);
mock.module(
	"renderer/routes/_authenticated/providers/LocalHostServiceProvider",
	() => ({ useLocalHostService: () => ({ activeOrganizationId: "org" }) }),
);
mock.module("renderer/lib/host-service-client", () => ({
	getHostServiceClientByUrl: () => {
		throw new Error("Collapse reached a host");
	},
}));
mock.module("renderer/lib/electron-trpc", () => ({
	electronTrpc: {
		projectCollections: {
			list: {
				useQuery: () => {
					const [data, setData] = useState(placements);
					update = setData;
					return { data, isSuccess: true };
				},
			},
			write: { useMutation: () => write },
			reconcile: { useMutation: () => reconcile },
		},
		useUtils: () => utils,
	},
}));
const { act, cleanup, render, waitFor } = await import(
	"@testing-library/react"
);
const { useProjectCollections } = await import("../useProjectCollections");
let isRail = false;
mock.module("renderer/hooks/useActiveOrganizationId", () => ({
	useActiveOrganizationId: () => "org",
}));
mock.module("renderer/stores/workspace-sidebar-state", () => ({
	useWorkspaceSidebarStore: () => isRail,
}));
const { electronTrpc } = await import("renderer/lib/electron-trpc");
Object.assign(electronTrpc, {
	resourceMetrics: {
		getSnapshot: {
			useQuery: () => ({ data: null, refetch: () => {}, isFetching: false }),
		},
	},
});
const { useResourceSnapshot } = await import(
	"../../../_dashboard/components/TopBar/components/ResourceConsumption/hooks/useResourceSnapshot/useResourceSnapshot"
);
const { renderHook } = await import("@testing-library/react");
let hook: ReturnType<typeof useProjectCollections>;
function Probe() {
	hook = useProjectCollections();
	return null;
}
afterEach(cleanup);
afterAll(async () => {
	if (!registered) await GlobalRegistrator.unregister();
});

test("restored workspace reveal waits for reconciliation and rapid chevrons keep both writes", async () => {
	const client = new QueryClient();
	const cancellations: unknown[] = [];
	const invalidations: unknown[] = [];
	const cancel = client.cancelQueries.bind(client);
	const invalidate = client.invalidateQueries.bind(client);
	client.cancelQueries = (...args) => {
		cancellations.push(args);
		return cancel(...args);
	};
	client.invalidateQueries = (...args) => {
		invalidations.push(args);
		return invalidate(...args);
	};
	render(
		<QueryClientProvider client={client}>
			<Probe />
		</QueryClientProvider>,
	);
	await waitFor(() => expect(reconcileStarted).toBe(true));
	await act(async () => {
		const reveal = hook.mutate({
			type: "collapse",
			tag: "team",
			isCollapsed: false,
		});
		const other = hook.mutate({
			type: "collapse",
			tag: "other",
			isCollapsed: true,
		});
		release();
		expect(await reveal).toBe(true);
		expect(await other).toBe(true);
	});
	expect(hook.collections.find((row) => row.tag === "team")?.isCollapsed).toBe(
		false,
	);
	expect(hook.collections.find((row) => row.tag === "other")?.isCollapsed).toBe(
		true,
	);
	expect(cancellations).toEqual([]);
	expect(invalidations).toEqual([]);
	expect(localInvalidations).toEqual(["placements"]);
	client.clear();
});

function rootProjectIds() {
	return hook.rootItems
		.filter((item) => item.type === "project")
		.map((item) => item.project.id);
}

test("a new root project precedes persisted projects after renumbering", async () => {
	const localHost = projectHosts[0];
	if (!localHost) throw new Error("Missing local project host");
	localHost.rows = ["a", "b", "new"].map((id) =>
		normalizeHostProjectRow({ id, repoPath: `/${id}`, tags: [] }),
	);
	sidebarProjects = [
		{ projectId: "a", tabOrder: 1, isHidden: false },
		{ projectId: "b", tabOrder: 2, isHidden: false },
		{ projectId: "new", tabOrder: 0, isHidden: false },
	];
	placements = [
		{ key: "a", kind: "project", tabOrder: 0, isCollapsed: false },
		{ key: "b", kind: "project", tabOrder: 1, isCollapsed: false },
	];
	const client = new QueryClient();
	render(
		<QueryClientProvider client={client}>
			<Probe />
		</QueryClientProvider>,
	);
	expect(rootProjectIds()).toEqual(["new", "a", "b"]);
	await act(async () => {
		expect(
			await hook.mutate({ type: "collapse", tag: "team", isCollapsed: true }),
		).toBe(true);
	});
	expect(rootProjectIds()).toEqual(["new", "a", "b"]);
	client.clear();
});

test("resource consumption uses the same resolved root and rail positions", () => {
	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<QueryClientProvider client={new QueryClient()}>
			{children}
		</QueryClientProvider>
	);
	const { result, unmount } = renderHook(() => useResourceSnapshot("v2"), {
		wrapper,
	});
	expect(result.current.sidebarProjectOrder).toEqual(["new", "a", "b"]);
	placements = [
		...placements,
		{ key: "rail:b", kind: "project", tabOrder: 0, isCollapsed: false },
		{ key: "rail:new", kind: "project", tabOrder: 1, isCollapsed: false },
		{ key: "rail:a", kind: "project", tabOrder: 2, isCollapsed: false },
	];
	isRail = true;
	unmount();
	const rail = renderHook(() => useResourceSnapshot("v2"), { wrapper });
	expect(rail.result.current.sidebarProjectOrder).toEqual(["b", "new", "a"]);
});
