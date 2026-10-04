import { cn } from "@superset/ui/utils";
import { memo, useRef } from "react";
import { columnName, MIN_COLUMN_WIDTH } from "../../../../utils/gridGeometry";
import { HEADER_SURFACE, HEADER_SURFACE_SELECTED } from "../../constants";

interface ColumnHeaderProps {
	col: number;
	left: number;
	width: number;
	selected: boolean;
	onResize: (col: number, width: number | null) => void;
}

export const ColumnHeader = memo(function ColumnHeader({
	col,
	left,
	width,
	selected,
	onResize,
}: ColumnHeaderProps) {
	const drag = useRef<{ startX: number; startWidth: number } | null>(null);

	return (
		<div
			className={cn(
				"absolute top-0 h-full select-none border-border border-r border-b text-center text-[11px] leading-6",
				selected
					? `${HEADER_SURFACE_SELECTED} text-foreground`
					: `${HEADER_SURFACE} text-muted-foreground`,
			)}
			style={{ left, width }}
		>
			{columnName(col)}
			<div
				aria-hidden
				className="absolute top-0 -right-1 z-10 h-full w-2 cursor-col-resize hover:bg-primary/40"
				onPointerDown={(event) => {
					event.stopPropagation();
					event.preventDefault();
					event.currentTarget.setPointerCapture(event.pointerId);
					drag.current = { startX: event.clientX, startWidth: width };
				}}
				onPointerMove={(event) => {
					if (!drag.current) return;
					onResize(
						col,
						Math.max(
							MIN_COLUMN_WIDTH,
							drag.current.startWidth + event.clientX - drag.current.startX,
						),
					);
				}}
				onPointerUp={() => {
					drag.current = null;
				}}
				onDoubleClick={() => onResize(col, null)}
			/>
		</div>
	);
});
