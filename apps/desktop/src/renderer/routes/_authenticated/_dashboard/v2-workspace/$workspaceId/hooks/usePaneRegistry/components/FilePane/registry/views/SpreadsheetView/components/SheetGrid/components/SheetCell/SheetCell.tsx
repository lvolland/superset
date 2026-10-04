import { cn } from "@superset/ui/utils";
import { memo } from "react";
import type { GridCell } from "../../../../types";

export type MatchState = "none" | "match" | "active";

interface SheetCellProps {
	top: number;
	left: number;
	width: number;
	height: number;
	cell: GridCell | null | undefined;
	match: MatchState;
	merged?: boolean;
}

const ALIGN: Record<GridCell["kind"], string> = {
	text: "text-left",
	number: "text-right tabular-nums",
	boolean: "text-center",
	error: "text-center text-destructive",
};

export const SheetCell = memo(function SheetCell({
	top,
	left,
	width,
	height,
	cell,
	match,
	merged = false,
}: SheetCellProps) {
	return (
		<div
			className={cn(
				"absolute truncate whitespace-nowrap px-1.5 text-xs leading-[23px]",
				merged && "z-[1] flex items-center bg-background",
				cell ? ALIGN[cell.kind] : undefined,
			)}
			style={{
				top,
				left,
				width,
				height,
				background:
					match === "active"
						? "var(--highlight-active)"
						: match === "match"
							? "var(--highlight-match)"
							: undefined,
			}}
		>
			{merged ? (
				<span className="w-full truncate">{cell?.text}</span>
			) : (
				cell?.text
			)}
		</div>
	);
});
