import { cn } from "@superset/ui/utils";
import { memo } from "react";
import { ROW_HEIGHT } from "../../../../utils/gridGeometry";
import { HEADER_SURFACE, HEADER_SURFACE_SELECTED } from "../../constants";

interface RowHeaderProps {
	row: number;
	top: number;
	width: number;
	selected: boolean;
}

export const RowHeader = memo(function RowHeader({
	row,
	top,
	width,
	selected,
}: RowHeaderProps) {
	return (
		<div
			className={cn(
				"absolute left-0 border-border border-r border-b pr-1.5 text-right text-[11px] tabular-nums leading-6",
				selected
					? `${HEADER_SURFACE_SELECTED} text-foreground`
					: `${HEADER_SURFACE} text-muted-foreground`,
			)}
			style={{ top, width, height: ROW_HEIGHT }}
		>
			{row + 1}
		</div>
	);
});
