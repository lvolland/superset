export interface DictationTarget {
	machineId: string;
	hostUrl: string;
	hostName: string;
}

export interface DictationAudio {
	uri: string;
	durationMs: number;
}

type Snapshot =
	| { status: "idle" }
	| {
			status: "transcribing" | "failed";
			audio: DictationAudio;
			target: DictationTarget;
			error?: unknown;
	  };

export function dictationEngineFor(
	target: DictationTarget | null,
	settings: { data: { enabled: boolean } | undefined; isPending: boolean },
): "apple" | "file" | "waiting" {
	if (!target) return "apple";
	if (settings.isPending || !settings.data) return "waiting";
	return settings.data.enabled ? "file" : "apple";
}

export function createDictationSession(dependencies: {
	transcribe: (
		audio: DictationAudio,
		target: DictationTarget,
	) => Promise<string>;
	append: (text: string) => void;
	remove: (uri: string) => void;
}) {
	let state: Snapshot = { status: "idle" };
	const listeners = new Set<() => void>();
	let running = false;
	const publish = (next: Snapshot) => {
		state = next;
		for (const listener of listeners) listener();
	};
	const remove = (uri: string) => {
		try {
			dependencies.remove(uri);
		} catch {}
	};
	const retry = async () => {
		if (running || state.status === "idle") return;
		running = true;
		const pending = state;
		publish({ ...pending, status: "transcribing", error: undefined });
		try {
			const text = await dependencies.transcribe(pending.audio, pending.target);
			dependencies.append(text);
			remove(pending.audio.uri);
			publish({ status: "idle" });
		} catch (error) {
			publish({ ...pending, status: "failed", error });
		} finally {
			running = false;
		}
	};
	return {
		getSnapshot: () => state,
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		accept: (audio: DictationAudio, target: DictationTarget) => {
			if (state.status !== "idle") return;
			publish({ status: "transcribing", audio, target });
			void retry();
		},
		retry,
		abandon: () => {
			if (running || state.status === "idle") return;
			remove(state.audio.uri);
			publish({ status: "idle" });
		},
	};
}
