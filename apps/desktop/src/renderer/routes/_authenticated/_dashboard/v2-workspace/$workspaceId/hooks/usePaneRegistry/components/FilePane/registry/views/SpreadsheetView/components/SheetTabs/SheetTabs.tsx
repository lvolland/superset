import { useLingui } from "@lingui/react/macro";
import { cn } from "@superset/ui/utils";
import { useEffect, useRef } from "react";
import type { SheetSummary } from "../../types";

interface SheetTabsProps {
	sheets: SheetSummary[];
	activeIndex: number;
	onSelect: (index: number) => void;
}

export function SheetTabs({ sheets, activeIndex, onSelect }: SheetTabsProps) {
	const { t } = useLingui();
	const activeRef = useRef<HTMLButtonElement>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll on tab change only
	useEffect(() => {
		activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [activeIndex]);

	return (
		<div
			role="tablist"
			aria-label={t({ message: "Sheets" })}
			className="flex h-7 shrink-0 items-center gap-0.5 overflow-x-auto border-border border-t px-1"
		>
			{sheets.map((sheet, index) => {
				const active = index === activeIndex;
				return (
					<button
						// biome-ignore lint/suspicious/noArrayIndexKey: sheet names can repeat across reloads, the index is the identity
						key={index}
						ref={active ? activeRef : undefined}
						type="button"
						role="tab"
						aria-selected={active}
						title={sheet.name}
						className={cn(
							"h-5 max-w-48 shrink-0 truncate rounded-sm px-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
							active
								? "bg-muted text-foreground"
								: "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
							sheet.hidden && "italic opacity-70",
						)}
						onClick={() => onSelect(index)}
					>
						{sheet.name}
					</button>
				);
			})}
		</div>
	);
}
