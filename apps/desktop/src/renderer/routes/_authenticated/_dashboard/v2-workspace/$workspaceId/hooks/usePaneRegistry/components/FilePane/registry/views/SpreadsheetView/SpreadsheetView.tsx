import { Trans } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import { useMemo } from "react";
import { LoadingState } from "../../../components/LoadingState";
import type { ViewProps } from "../../types";
import { SheetMessage } from "./components/SheetMessage";
import { WorkbookViewer } from "./components/WorkbookViewer";
import { useWorkbook } from "./hooks/useWorkbook";
import type { WorkbookSource } from "./types";

export function SpreadsheetView({
	document,
	filePath,
	isActive,
	embedded = false,
	onChangeView,
}: ViewProps) {
	const { content } = document;
	const source = useMemo<WorkbookSource | null>(() => {
		if (content.kind === "bytes") {
			return { kind: "bytes", bytes: content.value, fileName: filePath };
		}
		if (content.kind === "text") {
			return { kind: "text", text: content.value, fileName: filePath };
		}
		return null;
	}, [content, filePath]);
	const workbook = useWorkbook(source);

	if (workbook.status === "loading") {
		return <LoadingState />;
	}
	if (workbook.status === "error") {
		return (
			<SheetMessage
				detail={workbook.message || undefined}
				action={
					source?.kind === "text" && !embedded ? (
						<Button
							variant="outline"
							size="sm"
							onClick={() => onChangeView("code")}
						>
							<Trans>Show raw</Trans>
						</Button>
					) : undefined
				}
			>
				<Trans>This file could not be read as a spreadsheet</Trans>
			</SheetMessage>
		);
	}

	return (
		<WorkbookViewer
			client={workbook.client}
			sheets={workbook.sheets}
			isActive={isActive}
			embedded={embedded}
		/>
	);
}
