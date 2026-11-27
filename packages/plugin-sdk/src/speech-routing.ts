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

export interface SpeechPackVoiceProfile {
  model?: string;
  voice_id?: string;
  instruction?: string;
  emotion?: string;
  rate?: string;
  pitch?: string;
}

export interface SpeechPackCandidate<
  TProfile extends SpeechPackVoiceProfile = SpeechPackVoiceProfile,
> {
  id: string;
  name: string;
  workspace?: number;
  purpose?: string;
  updated?: number;
  voice_profile?: TProfile | null;
}

export function resolveDialogueVoiceProfile<
  TProfile extends SpeechPackVoiceProfile = SpeechPackVoiceProfile,
>(input: {
  workspaceId?: number;
  packs?: readonly SpeechPackCandidate<TProfile>[];
  line: {
    speaker?: string;
    pack_id?: string | null;
    model?: string;
    voice_id?: string;
    instruction?: string;
  };
}): {
  packId: string | null;
  model?: string;
  voiceId?: string;
  instruction: string;
  rate?: string;
  pitch?: string;
  emotion?: string;
} {
  const localPacks = (input.packs ?? []).filter(
    (p) =>
      input.workspaceId === undefined ||
      p.workspace === undefined ||
      p.workspace === input.workspaceId,
  );

  let matchedPackId: string | null = null;
  let profile: TProfile | null = null;

  if (input.line.pack_id) {
    const byId = localPacks.find((p) => p.id === input.line.pack_id);
    if (byId) {
      matchedPackId = byId.id;
      profile = byId.voice_profile ?? null;
    }
  }

  if (!profile && input.line.speaker?.trim()) {
    const speakerNorm = input.line.speaker.trim().toLowerCase();
    const subjectPacks = localPacks
      .filter((p) => (p.purpose ?? "subject") === "subject")
      .slice()
      .sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0));
    const match = subjectPacks.find(
      (p) => p.name.trim().toLowerCase() === speakerNorm,
    );
    if (match) {
      matchedPackId = match.id;
      profile = match.voice_profile ?? null;
    }
  }

  const baseInstruction = [profile?.emotion, profile?.instruction]
    .filter((s): s is string => Boolean(s && s.trim()))
    .join("，");
  const instruction = (
    input.line.instruction?.trim() || baseInstruction
  ).slice(0, 300);

  return {
    packId: matchedPackId,
    model: input.line.model?.trim() || profile?.model?.trim() || undefined,
    voiceId:
      input.line.voice_id?.trim() || profile?.voice_id?.trim() || undefined,
    instruction,
    rate: profile?.rate,
    pitch: profile?.pitch,
    emotion: profile?.emotion,
  };
}
