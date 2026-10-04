import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ProjectCollection } from "renderer/routes/_authenticated/utils/projectCollections/projectCollections";
import type { SidebarProjectCollectionsValue } from "../../providers/DashboardSidebarProjectCollectionsProvider";

const alreadyRegistered = GlobalRegistrator.isRegistered;
if (!alreadyRegistered) GlobalRegistrator.register();
(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const { act, cleanup, fireEvent, render, within } = await import(
	"@testing-library/react"
);
const { DndContext } = await import("@dnd-kit/core");
const { DashboardSidebarCollection } = await import(
	"./DashboardSidebarCollection"
);
const { DashboardSidebarProjectCollectionsProvider } = await import(
	"../../providers/DashboardSidebarProjectCollectionsProvider"
);

const collection: ProjectCollection<{ id: string }> = {
	id: "projects:team",
	tag: "team",
	name: "Dibsteur",
	color: "#ef4444",
	tabOrder: 0,
	isCollapsed: true,
	projects: [{ id: "a" }, { id: "b" }],
};
const run = mock(async () => true);
const setEditingTag = mock(() => {});
const setNewCollectionTag = mock(() => {});

function mount(
	editingTag: string | null = null,
	isCollapsed = true,
	newCollectionTag: string | null = null,
) {
	const value = {
		editingTag,
		newCollectionTag,
		setNewCollectionTag,
		collections: [collection],
		setEditingTag,
		run,
	} as unknown as SidebarProjectCollectionsValue;
	return render(
		<DashboardSidebarProjectCollectionsProvider value={value}>
			<DndContext>
				<DashboardSidebarCollection
					collection={{ ...collection, isCollapsed }}
					isDragDisabled={false}
				>
					<span>Member project</span>
				</DashboardSidebarCollection>
			</DndContext>
		</DashboardSidebarProjectCollectionsProvider>,
	);
}

afterEach(() => {
	cleanup();
	run.mockClear();
	setEditingTag.mockClear();
	setNewCollectionTag.mockClear();
	document.body.style.pointerEvents = "";
});
afterAll(async () => {
	if (!alreadyRegistered) await GlobalRegistrator.unregister();
});

describe("collection row", () => {
	test("collapsed rows expose state, count, and chosen color", () => {
		mount();
		const page = within(document.body);
		const label = page.getByText("Dibsteur");
		const header = label.closest('[role="button"]');
		expect(header?.getAttribute("aria-expanded")).toBe("false");
		expect(page.getByText("2")).toBeTruthy();
		expect(page.queryByText("Member project")).toBeNull();
		expect(
			(label.previousElementSibling as HTMLElement).style.backgroundColor,
		).toBe("#ef4444");
	});
	test("expanded rows show members without a count", () => {
		mount(null, false);
		const page = within(document.body);
		expect(page.getByText("Member project")).toBeTruthy();
		expect(page.queryByText("2")).toBeNull();
		expect(
			page
				.getByText("Dibsteur")
				.closest('[role="button"]')
				?.getAttribute("aria-expanded"),
		).toBe("true");
	});
	test("Enter toggles collapse without starting a drag", async () => {
		mount();
		const header = within(document.body)
			.getByText("Dibsteur")
			.closest('[role="button"]');
		if (!header) throw new Error("Missing collection header");
		await act(async () => {
			fireEvent.keyDown(header, { key: "Enter" });
		});
		expect(run).toHaveBeenCalledWith({
			type: "collapse",
			tag: "team",
			isCollapsed: false,
		});
	});
	test("inline rename focuses the input and saves once on Enter", async () => {
		mount("team");
		const input = within(document.body).getByRole("textbox", {
			name: "Collection name",
		});
		expect(document.activeElement).toBe(input);
		await act(async () => {
			fireEvent.change(input, { target: { value: "Work" } });
			fireEvent.keyDown(input, { key: "Enter" });
		});
		expect(run).toHaveBeenCalledTimes(1);
		expect(run).toHaveBeenCalledWith({
			type: "rename",
			tag: "team",
			name: "Work",
		});
		expect(setEditingTag).toHaveBeenCalledWith(null);
	});
	test("Escape cancels rename without writing", async () => {
		mount("team");
		const input = within(document.body).getByRole("textbox", {
			name: "Collection name",
		});
		await act(async () => {
			fireEvent.change(input, { target: { value: "Discarded" } });
			fireEvent.keyDown(input, { key: "Escape" });
		});
		expect(run).not.toHaveBeenCalled();
		expect(setEditingTag).toHaveBeenCalledWith(null);
	});
	test("collection context menu offers rename, color, and delete", async () => {
		mount();
		await act(async () => {
			fireEvent.contextMenu(within(document.body).getByText("Dibsteur"), {
				clientX: 10,
				clientY: 10,
			});
		});
		const page = within(document.body);
		expect(page.getByRole("menuitem", { name: "Rename" })).toBeTruthy();
		expect(page.getByRole("menuitem", { name: "Color" })).toBeTruthy();
		await act(async () => {
			fireEvent.click(
				page.getByRole("menuitem", { name: "Delete collection" }),
			);
		});
		expect(run).toHaveBeenCalledWith({ type: "delete", tag: "team" });
	});
});

test("the first inline name mints the readable CLI tag", async () => {
	mount("team", true, "team");
	const input = within(document.body).getByRole("textbox", {
		name: "Collection name",
	});
	await act(async () => {
		fireEvent.change(input, { target: { value: "Perso" } });
		fireEvent.keyDown(input, { key: "Enter" });
	});
	expect(run).toHaveBeenCalledWith({
		type: "rename",
		tag: "team",
		name: "Perso",
		replacementTag: "perso",
	});
	expect(setNewCollectionTag).toHaveBeenCalledWith(null);
});

test("dragging a collection hides the members of every collection", async () => {
	const value = {
		editingTag: null,
		newCollectionTag: null,
		setNewCollectionTag,
		collections: [collection],
		setEditingTag,
		run,
	} as unknown as SidebarProjectCollectionsValue;
	render(
		<DashboardSidebarProjectCollectionsProvider value={value}>
			<DndContext>
				<DashboardSidebarCollection
					collection={{ ...collection, isCollapsed: false }}
					isDragDisabled={false}
				>
					<span>Member project</span>
				</DashboardSidebarCollection>
				<DashboardSidebarCollection
					collection={{
						...collection,
						id: "projects:home",
						tag: "home",
						name: "Perso",
						isCollapsed: false,
					}}
					isDragDisabled={false}
				>
					<span>Other member</span>
				</DashboardSidebarCollection>
			</DndContext>
		</DashboardSidebarProjectCollectionsProvider>,
	);
	const page = within(document.body);
	const header = page.getByText("Dibsteur").closest('[role="button"]');
	if (!header) throw new Error("Missing collection header");
	await act(async () => {
		fireEvent.pointerDown(header, { isPrimary: true, button: 0 });
	});
	expect(page.queryByText("Member project")).toBeNull();
	expect(page.queryByText("Other member")).toBeNull();
	await act(async () => {
		fireEvent.pointerUp(document);
	});
	expect(page.getByText("Member project")).toBeTruthy();
	expect(page.getByText("Other member")).toBeTruthy();
});
