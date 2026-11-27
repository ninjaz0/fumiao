const BGM_MODEL_IDS = new Set([
  "bgm-v1",
  "suno-v4",
  "udio-v1.5",
  "musicgen-large",
]);

const SPEECH_PRIORITY_ORDER = [
  "breeze-tts-2",
  "tts-1",
  "gpt-4o-mini-tts",
  "local-tts-compat",
] as const;

export function isBgmMusicModel(
  modelId: string,
  spec?: { kind?: string; provider?: string } | null,
): boolean {
  if (BGM_MODEL_IDS.has(modelId)) return true;
  if (!spec || spec.kind !== "audio") return false;
  if (spec.provider === "bgm-generator") return true;
  if (
    typeof spec.provider === "string" &&
    /(?:^|[-_])(bgm|music)(?:$|[-_])/i.test(spec.provider)
  ) {
    return true;
  }
  return false;
}

export function pickSpeechAudioModel(input: {
  preferredModel?: string | null;
  availableSpeechIds: readonly string[];
  defaultModelIds?: readonly string[];
}): string {
  const available = new Set(input.availableSpeechIds);
  if (available.size === 0) return "";

  const preferred = input.preferredModel?.trim() || "";
  if (preferred && available.has(preferred)) {
    return preferred;
  }

  if (input.defaultModelIds?.length) {
    const activeDefaults = input.defaultModelIds.filter((id) =>
      available.has(id),
    );
    if (activeDefaults.length === 1) return activeDefaults[0];
  }

  for (const id of SPEECH_PRIORITY_ORDER) {
    if (available.has(id)) return id;
  }

  for (const id of input.availableSpeechIds) {
    if (id !== "edge-tts") return id;
  }

  if (available.has("edge-tts")) return "edge-tts";
  return "";
}
