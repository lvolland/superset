import { useEffect, useState } from "react";
import type { SheetSummary, WorkbookSource } from "../../types";
import { createSheetWorker, SheetWorkerClient } from "../../utils/sheetWorker";

export type WorkbookState =
	| { status: "loading" }
	| { status: "ready"; client: SheetWorkerClient; sheets: SheetSummary[] }
	| { status: "error"; message: string };

/** Parses the source in a worker, which then serves rows on demand. */
export function useWorkbook(source: WorkbookSource | null): WorkbookState {
	const [state, setState] = useState<WorkbookState>({ status: "loading" });

	useEffect(() => {
		if (!source) {
			setState({ status: "loading" });
			return;
		}
		const client = new SheetWorkerClient(createSheetWorker());
		let cancelled = false;
		setState({ status: "loading" });
		client.request({ type: "open", source }).then(
			(sheets) => {
				if (!cancelled) setState({ status: "ready", client, sheets });
			},
			(error: unknown) => {
				if (cancelled) return;
				setState({
					status: "error",
					message: error instanceof Error ? error.message : String(error),
				});
			},
		);
		return () => {
			cancelled = true;
			client.dispose();
		};
	}, [source]);

	return state;
}
