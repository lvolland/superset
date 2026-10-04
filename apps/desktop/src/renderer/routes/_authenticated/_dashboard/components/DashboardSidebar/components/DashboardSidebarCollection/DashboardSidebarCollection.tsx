import { useDroppable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useLingui } from "@lingui/react/macro";
import { formatNumber } from "@superset/i18n/format";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuTrigger,
} from "@superset/ui/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { cn } from "@superset/ui/utils";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { HiEllipsisHorizontal } from "react-icons/hi2";
import type { ProjectCollection } from "renderer/routes/_authenticated/utils/projectCollections/projectCollections";
import { mintFolderTag } from "renderer/routes/_authenticated/utils/workspaceTagFolders";
import { collectionDropId } from "../../hooks/useSidebarDnd/projectCollectionDrop";
import { useSidebarProjectCollections } from "../../providers/DashboardSidebarProjectCollectionsProvider/DashboardSidebarProjectCollectionsProvider";
import { DashboardSidebarGroupHeader } from "../DashboardSidebarGroupHeader";
import { CollectionMenuItems } from "./components/CollectionMenuItems/CollectionMenuItems";

interface DashboardSidebarCollectionProps {
	collection: ProjectCollection<{ id: string }>;
	isDragDisabled: boolean;
	children: ReactNode;
}

export function DashboardSidebarCollection({
	collection,
	isDragDisabled,
	children,
}: DashboardSidebarCollectionProps) {
	const { t } = useLingui();
	const state = useSidebarProjectCollections();
	const editing = state?.editingTag === collection.tag;
	const [name, setName] = useState(collection.name);
	const input = useRef<HTMLInputElement>(null);
	const submitting = useRef(false);
	const {
		setNodeRef,
		attributes,
		listeners,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: collection.id, disabled: isDragDisabled || editing });
	const { setNodeRef: setDropRef, isOver } = useDroppable({
		id: collectionDropId(collection.id),
		disabled: isDragDisabled,
	});
	useEffect(() => {
		if (editing) {
			setName(collection.name);
			input.current?.focus();
			input.current?.select();
		}
	}, [editing, collection.name]);
	const submit = async () => {
		if (submitting.current) return;
		submitting.current = true;
		try {
			if (name.trim() && name.trim() !== collection.name) {
				const saved = await state?.run({
					type: "rename",
					tag: collection.tag,
					name: name.trim(),
					...(state?.newCollectionTag === collection.tag
						? {
								replacementTag: mintFolderTag(
									name,
									state.collections
										.filter((row) => row.tag !== collection.tag)
										.map((row) => row.tag),
								),
							}
						: {}),
				});
				if (!saved) return;
			}
			state?.setNewCollectionTag(null);
			state?.setEditingTag(null);
		} finally {
			submitting.current = false;
		}
	};
	const menuProps = {
		color: collection.color,
		onRename: () => state?.setEditingTag(collection.tag),
		onColor: (color: string | null) => {
			void state?.run({ type: "color", tag: collection.tag, color });
		},
		onDelete: () => {
			void state?.run({ type: "delete", tag: collection.tag });
		},
	};
	return (
		<div
			style={{
				transform: CSS.Translate.toString(transform),
				transition,
				opacity: isDragging ? 0.5 : undefined,
			}}
		>
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<DashboardSidebarGroupHeader
						ref={setNodeRef}
						indentation="top-level"
						isCollapsed={collection.isCollapsed}
						isEditing={editing}
						isDraggable={!isDragDisabled}
						onToggleCollapse={() => {
							void state?.run({
								type: "collapse",
								tag: collection.tag,
								isCollapsed: !collection.isCollapsed,
							});
						}}
						className={cn(
							"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
							isOver && "bg-fill-selected",
						)}
						{...(editing ? {} : attributes)}
						{...(editing ? {} : listeners)}
						{...(editing ? {} : { "aria-expanded": !collection.isCollapsed })}
						onKeyDown={
							editing
								? undefined
								: (event) => {
										if (event.key === "Enter" || event.key === " ") {
											event.preventDefault();
											void state?.run({
												type: "collapse",
												tag: collection.tag,
												isCollapsed: !collection.isCollapsed,
											});
										}
									}
						}
						label={
							<span
								ref={setDropRef}
								className="flex min-w-0 flex-1 items-center gap-2"
							>
								<span
									className="size-2.5 shrink-0 rounded-full bg-muted-foreground"
									style={
										collection.color
											? { backgroundColor: collection.color }
											: undefined
									}
								/>
								{editing ? (
									<input
										ref={input}
										aria-label={t({ message: "Collection name" })}
										className="min-w-0 w-full bg-transparent outline-none"
										value={name}
										maxLength={200}
										onChange={(event) => setName(event.target.value)}
										onBlur={() => {
											void submit();
										}}
										onKeyDown={(event) => {
											event.stopPropagation();
											if (event.key === "Enter") {
												event.preventDefault();
												void submit();
											}
											if (event.key === "Escape") {
												event.preventDefault();
												state?.setNewCollectionTag(null);
												state?.setEditingTag(null);
											}
										}}
									/>
								) : (
									<span className="truncate">{collection.name}</span>
								)}
								{collection.isCollapsed && (
									<span className="ml-auto text-xs tabular-nums">
										{formatNumber(collection.projects.length)}
									</span>
								)}
							</span>
						}
						actions={
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<button
										type="button"
										aria-label={t({ message: "Collection actions" })}
										className="size-5 rounded hover:bg-fill-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									>
										<HiEllipsisHorizontal className="size-4" />
									</button>
								</DropdownMenuTrigger>
								<DropdownMenuContent
									onCloseAutoFocus={(event) => event.preventDefault()}
								>
									<CollectionMenuItems kind="dropdown" {...menuProps} />
								</DropdownMenuContent>
							</DropdownMenu>
						}
					/>
				</ContextMenuTrigger>
				<ContextMenuContent
					onCloseAutoFocus={(event) => event.preventDefault()}
				>
					<CollectionMenuItems kind="context" {...menuProps} />
				</ContextMenuContent>
			</ContextMenu>
			{!collection.isCollapsed && <div className="ml-3">{children}</div>}
		</div>
	);
}
