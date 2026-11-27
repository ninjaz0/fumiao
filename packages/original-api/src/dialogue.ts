import type { Sql } from "@fumiao/platform/db.js";
import type { PackVoiceProfile } from "@fumiao/platform/packs.js";
import type { CanvasSubmissionModels } from "@fumiao/platform/canvas-submission.js";
import { requireValue } from "@fumiao/platform/security.js";
import { pythonStrip } from "@fumiao/plugin-sdk/python-values.js";
import type { DialogueLine } from "./canvas-draft.js";

export interface ParsedDialogueLine {
  speaker: string;
  emotion?: string;
  text: string;
}

/**
 * Parse screenplay dialogue lines such as:
 *   林墨：今天这场雨不对劲。
 *   苏青（紧张）：快看窗外！
 */
export function parseDialogueScript(raw: string): ParsedDialogueLine[] {
  const lines: ParsedDialogueLine[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    const m = /^([^:：]{1,32}?)(?:[（(]([^）)]{1,24})[）)])?\s*[:：]\s*(.+)$/.exec(
      trimmed,
    );
    if (m) {
      const speaker = m[1].trim();
      const emotion = m[2]?.trim();
      const text = m[3].trim();
      if (text) {
        lines.push({
          speaker,
          ...(emotion ? { emotion } : {}),
          text,
        });
      }
    } else {
      lines.push({ speaker: "旁白", text: trimmed });
    }
  }
  return lines;
}

export interface ResolvedSpeakerVoice {
  packId: string | null;
  model?: string;
  voiceId?: string;
  instruction: string;
  rate?: string;
  pitch?: string;
  emotion?: string;
}

/**
 * Resolve a dialogue line's effective TTS voice profile from workspace character
 * asset packs (`purpose='subject'` + `asset_pack_meta.voice_profile`), merged with
 * explicit line-level overrides.
 */
export async function resolveSpeakerVoice(
  sql: Sql,
  workspaceId: string,
  line: {
    speaker?: string;
    pack_id?: string | null;
    model?: string;
    voice_id?: string;
    instruction?: string;
  },
): Promise<ResolvedSpeakerVoice> {
  let matchedPackId: string | null = null;
  let profile: PackVoiceProfile | null = null;

  if (line.pack_id) {
    const row = (
      await sql.query<{ public_id: string; voice_profile: PackVoiceProfile | null }>(
        `SELECT d.public_id, m.voice_profile
         FROM documents d
         LEFT JOIN asset_pack_meta m ON m.pack_id = d.id
         WHERE d.workspace_id = $1 AND d.kind = 'pack' AND NOT d.deleted AND d.public_id = $2
         LIMIT 1`,
        [workspaceId, line.pack_id],
      )
    ).rows[0];
    if (row) {
      matchedPackId = row.public_id;
      profile = row.voice_profile ?? null;
    }
  }

  if (!profile && line.speaker?.trim()) {
    const speakerNorm = line.speaker.trim().toLowerCase();
    const rows = (
      await sql.query<{
        public_id: string;
        title: string;
        pack_text: { name?: string } | null;
        voice_profile: PackVoiceProfile | null;
      }>(
        `SELECT d.public_id, d.title, d.pack_text, m.voice_profile
         FROM documents d
         LEFT JOIN asset_pack_meta m ON m.pack_id = d.id
         WHERE d.workspace_id = $1 AND d.kind = 'pack' AND NOT d.deleted
           AND COALESCE(d.body->>'purpose', 'subject') = 'subject'
         ORDER BY d.updated_at DESC`,
        [workspaceId],
      )
    ).rows;
    const match = rows.find((r) => {
      const packName = (r.pack_text?.name ?? r.title ?? "").trim().toLowerCase();
      return packName === speakerNorm;
    });
    if (match) {
      matchedPackId = match.public_id;
      profile = match.voice_profile ?? null;
    }
  }

  const baseInstruction = [profile?.emotion, profile?.instruction]
    .filter((s): s is string => Boolean(s && s.trim()))
    .join("，");
  const instruction = (line.instruction?.trim() || baseInstruction).slice(0, 300);

  return {
    packId: matchedPackId,
    model: line.model?.trim() || profile?.model,
    voiceId: line.voice_id?.trim() || profile?.voice_id,
    instruction,
    rate: profile?.rate,
    pitch: profile?.pitch,
    emotion: profile?.emotion,
  };
}

export async function resolveDialogueInput(
  sql: Sql,
  workspaceId: string,
  line: DialogueLine,
  bindings: CanvasSubmissionModels,
) {
  const prompt = pythonStrip(line.text);
  requireValue(prompt, 400, "对白台词不能为空");
  const voice = await resolveSpeakerVoice(sql, workspaceId, line);
  const params = {
    ...(voice.voiceId ? { voice: voice.voiceId } : {}),
    ...(voice.rate ? { rate: voice.rate } : {}),
    ...(voice.pitch ? { pitch: voice.pitch } : {}),
    ...(voice.instruction ? { instruction: voice.instruction } : {}),
  };
  return {
    line,
    voice,
    payload: {
      model: bindings.resolveAudio(voice.model),
      prompt,
      instruction: voice.instruction,
      ...(Object.keys(params).length ? { params } : {}),
    },
  };
}
