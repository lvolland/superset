import { useLingui } from "@lingui/react/macro";
import type { ComposerHandle } from "@superset/composer";
import { useQuery } from "@tanstack/react-query";
import { File } from "expo-file-system";
import {
	type RefObject,
	useEffect,
	useEffectEvent,
	useRef,
	useSyncExternalStore,
} from "react";
import { Alert } from "react-native";
import { getHostServiceClientByUrl } from "@/lib/host-service/client";
import { isTrpcErrorWithData } from "@/lib/host-service/errors";
import { useComposerDraftsStore } from "@/screens/(authenticated)/stores/composerDraftsStore";
import {
	createDictationSession,
	type DictationAudio,
	type DictationTarget,
	dictationEngineFor,
} from "./dictationSession";

const composers = new Map<string, RefObject<ComposerHandle | null>>();
const sessions = new Map<string, ReturnType<typeof createDictationSession>>();

function sessionFor(key: string) {
	let session = sessions.get(key);
	if (session) return session;
	session = createDictationSession({
		transcribe: async (audio, target) => {
			let encoded: string;
			try {
				encoded = await new File(audio.uri).base64();
			} catch {
				throw { data: { dictation: { kind: "INVALID_AUDIO" } } };
			}
			const result = await getHostServiceClientByUrl(
				target.hostUrl,
			).dictation.transcribe.mutate({
				audio: encoded,
				mediaType: "audio/mp4",
			});
			return result.text;
		},
		append: (text) => {
			const composer = composers.get(key)?.current;
			if (composer) {
				composer.appendDraft(text);
				return;
			}
			const store = useComposerDraftsStore.getState();
			const previous = store.draftsByKey[key]?.text ?? "";
			store.setText(key, previous ? `${previous} ${text}` : text);
		},
		remove: (uri) => new File(uri).delete(),
	});
	sessions.set(key, session);
	return session;
}

export function useHostDictation({
	target,
	draftKey,
	composerRef,
}: {
	target: DictationTarget | null;
	draftKey: string;
	composerRef: RefObject<ComposerHandle | null>;
}) {
	const { t } = useLingui();
	const recordingTarget = useRef<DictationTarget | null>(null);
	const query = useQuery({
		queryKey: [
			"host-service",
			"superwhisper",
			target?.machineId,
			target?.hostUrl,
		],
		enabled: target !== null,
		staleTime: 0,
		refetchOnWindowFocus: "always",
		networkMode: "always",
		retry: false,
		queryFn: async () => {
			if (!target) return { enabled: false };
			try {
				return await getHostServiceClientByUrl(
					target.hostUrl,
				).settings.superwhisper.get.query();
			} catch (error) {
				if (isTrpcErrorWithData(error) && error.data.code === "NOT_FOUND") {
					return { enabled: false };
				}
				throw error;
			}
		},
	});
	const session = sessionFor(draftKey);
	const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
	const engine = dictationEngineFor(
		target,
		query.isError || query.isFetching ? undefined : query.data,
	);

	const errorText = (error: unknown) => {
		const kind = (error as { data?: { dictation?: { kind?: string } } })?.data
			?.dictation?.kind;
		switch (kind) {
			case "DISABLED":
				return t({
					message: "Superwhisper dictation is disabled on this Mac.",
				});
			case "UNAVAILABLE":
				return t({ message: "Superwhisper is not installed on this Mac." });
			case "MODE_NOT_READY":
				return t({
					message: "The Superset mode in Superwhisper is not ready.",
				});
			case "INVALID_AUDIO":
				return t({ message: "Superwhisper could not read the recording." });
			case "TIMEOUT":
				return t({
					message:
						"Superwhisper did not respond in time. Check that it has a Pro license on your Mac.",
				});
			case "RESTORE_FAILED":
				return t({
					message:
						"Superwhisper could not restore your Mac's mode or clipboard.",
				});
			case "TRANSCRIPTION_FAILED":
				return t({
					message: "Superwhisper could not transcribe the recording.",
				});
			default:
				return t({ message: "Could not reach the Mac for transcription." });
		}
	};
	const showFailure = () => {
		if (state.status !== "failed") return;
		Alert.alert(
			t({ message: "Transcription failed" }),
			errorText(state.error),
			[
				{
					text: t({ message: "Abandon" }),
					style: "destructive",
					onPress: session.abandon,
				},
				{ text: t({ message: "Retry" }), onPress: () => void session.retry() },
			],
			{ cancelable: false },
		);
	};
	const onFailed = useEffectEvent(showFailure);
	useEffect(() => {
		if (state.status === "failed") onFailed();
	}, [state]);
	useEffect(() => {
		composers.set(draftKey, composerRef);
		return () => {
			if (composers.get(draftKey) === composerRef) composers.delete(draftKey);
		};
	}, [draftKey, composerRef]);

	const name =
		state.status === "idle" ? target?.hostName : state.target.hostName;
	return {
		dictationEngine: engine === "file" ? ("file" as const) : ("apple" as const),
		dictationRemoteBusy: state.status !== "idle",
		dictationBlocked: engine === "waiting" || state.status !== "idle",
		dictationStatus:
			state.status === "transcribing"
				? t({ message: `Transcription on ${name}` })
				: state.status === "failed"
					? t({ message: "Transcription failed" })
					: engine === "waiting"
						? query.isError
							? t({ message: "Could not check dictation settings" })
							: t({ message: "Checking dictation settings" })
						: "",
		onDictationStart: () => {
			recordingTarget.current = target;
		},
		onDictationAudio: (audio: DictationAudio) => {
			if (recordingTarget.current)
				session.accept(audio, recordingTarget.current);
		},
		onDictationStatusPress: () => {
			if (state.status === "failed") showFailure();
			else if (query.isError) {
				Alert.alert(
					t({ message: "Could not check dictation settings" }),
					undefined,
					[
						{ text: t({ message: "Cancel" }), style: "cancel" },
						{
							text: t({ message: "Retry" }),
							onPress: () => void query.refetch(),
						},
					],
				);
			}
		},
	};
}
