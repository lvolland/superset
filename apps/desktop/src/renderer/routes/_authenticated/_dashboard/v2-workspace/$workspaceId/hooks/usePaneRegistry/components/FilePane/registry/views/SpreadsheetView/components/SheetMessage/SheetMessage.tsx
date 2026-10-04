import type { ReactNode } from "react";

interface SheetMessageProps {
	children: ReactNode;
	detail?: string;
	action?: ReactNode;
}

export function SheetMessage({ children, detail, action }: SheetMessageProps) {
	return (
		<div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground text-sm">
			<span className="cursor-text select-text">{children}</span>
			{detail && (
				<span className="max-w-md cursor-text select-text text-xs text-muted-foreground/70">
					{detail}
				</span>
			)}
			{action}
		</div>
	);
}
