import { randomUUID } from "node:crypto";
import type { Actor, Platform } from "@fumiao/platform/platform.js";
import {
  ReferencePacks,
  type PackDraft,
  type PackScope,
  type PackTurnaroundViews,
} from "@fumiao/platform/packs.js";
import { CanvasSubmissionModels } from "@fumiao/platform/canvas-submission.js";
import { StudioCatalog } from "@fumiao/platform/catalog.js";
import { requireValue } from "@fumiao/platform/security.js";
import { OriginalIdentity, type OriginalActor } from "./identity.js";
import { OriginalGeneration } from "./generation.js";
import { parseDraft } from "./drafts.js";
import { parseBody } from "./validation.js";
import { identityBodies } from "./contracts.js";

export function buildTurnaroundPrompt(
  name: string,
  description: string,
  styleNote?: string,
  view: "sheet" | "front" | "side" | "back" = "sheet",
) {
  const detail = description.trim() || name.trim();
  const viewInstructions: Record<"sheet" | "front" | "side" | "back", string> = {
    sheet:
      "同一张宽幅设定图中并排展示该角色的三个标准全身视角：左侧为正面（Front View），中间为正侧面（Side Profile View），右侧为背面（Back View）。",
    front:
      "标准全身正面定妆照（Front View）：正对镜头，头身比、五官、发型、服装纹理与配饰清晰完整。",
    side:
      "标准全身正侧面定妆照（Side Profile View）：严格 90 度侧面轮廓，发型、五官侧影与服装剪裁与正面完全一致。",
    back:
      "标准全身背面定妆照（Back View）：背对镜头展示发尾、服装背部结构与配饰细节，与正面完全一致。",
  };
  const base = [
    `角色设定图（Turnaround Character Reference）：「${name.trim()}」`,
    viewInstructions[view],
    "纯浅灰/纯白无杂物摄影棚背景，自然中立站姿，均匀平光，清晰干净的影视定妆照质感，无多余文字水印。",
    detail ? `角色特征描述：${detail}` : "",
    styleNote?.trim() ? `补充风格要求：${styleNote.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return base.slice(0, 11000);
}

export class OriginalPacks {
  readonly packs: ReferencePacks;
  readonly identity: OriginalIdentity;
  readonly generation: OriginalGeneration;
  constructor(readonly p: Platform) {
    this.packs = new ReferencePacks(p.db);
    this.identity = new OriginalIdentity(p);
    this.generation = new OriginalGeneration(p);
  }
  async list(user: Actor, selected?: string) {
    const workspace = await this.identity.activeWorkspace(
      this.p.db,
      user,
      selected,
    );
    return this.packs.list(user, workspace.id);
  }
  async save(user: Actor, value: unknown, selected?: string, key?: string) {
    const draft = parseBody(value, identityBodies.packDraft, true) as PackDraft;
    return this.p.db.transaction(async (sql) => {
      const workspace = await this.identity.activeWorkspace(
        sql,
        user,
        selected,
      );
      return this.packs.view(
        sql,
        await this.packs.save(sql, user, workspace.id, draft, key),
      );
    });
  }
  async remove(user: Actor, key: string, selected?: string) {
    return this.p.db.transaction(async (sql) => {
      const workspace = await this.identity.activeWorkspace(
        sql,
        user,
        selected,
      );
      return this.packs.remove(sql, user, key, workspace.id);
    });
  }
  async setLock(
    user: Actor,
    key: string,
    locked: boolean,
    selected?: string,
  ) {
    return this.p.db.transaction(async (sql) => {
      const workspace = await this.identity.activeWorkspace(
        sql,
        user,
        selected,
      );
      return this.packs.view(
        sql,
        await this.packs.setLock(sql, user, key, workspace.id, locked),
      );
    });
  }
  async setScope(
    user: Actor,
    key: string,
    value: unknown,
    selected?: string,
  ) {
    const body = parseBody(value, identityBodies.packScope, true) as {
      scope: PackScope;
    };
    return this.p.db.transaction(async (sql) => {
      const workspace = await this.identity.activeWorkspace(
        sql,
        user,
        selected,
      );
      return this.packs.view(
        sql,
        await this.packs.setScope(sql, user, key, workspace.id, body.scope),
      );
    });
  }
  /**
   * F009: Either bind explicit turnaround view assets (`views: { front, side, back, sheet }`)
   * or submit a standard 3-view character sheet image generation job seeded from the pack.
   */
  async turnaround(
    user: OriginalActor,
    key: string,
    value: unknown,
    selected?: string,
  ) {
    const body = parseBody(value, identityBodies.packTurnaround, true) as {
      views?: PackTurnaroundViews | null;
      view?: "sheet" | "front" | "side" | "back";
      model?: string;
      ratio?: string;
      resolution?: string;
      image_quality?: string;
      style_note?: string;
      uid?: string | null;
      price_revision?: number | null;
    };
    return this.p.db.transaction(async (sql) => {
      const workspace = await this.identity.activeWorkspace(
        sql,
        user,
        selected,
      );
      if (body.views) {
        const updated = await this.packs.attachTurnaroundViews(
          sql,
          user,
          key,
          workspace.id,
          body.views,
        );
        return { mode: "attached" as const, pack: await this.packs.view(sql, updated) };
      }
      const row = await this.packs.get(sql, user, key, workspace.id, true, "share");
      requireValue(!row.locked, 409, "素材包已锁定，请先解锁后再生成三视图");
      const pack = await this.packs.view(sql, row);
      const targetView = body.view ?? "sheet";
      const prompt = buildTurnaroundPrompt(
        pack.name,
        pack.description,
        body.style_note,
        targetView,
      );
      const bindings = await CanvasSubmissionModels.read(sql, {
        strict: false,
      });
      const catalog = await new StudioCatalog(this.p.db).catalog(sql);
      const model =
        body.model ||
        (() => {
          try {
            return bindings.default("image");
          } catch {
            return (
              Object.values(catalog).find((m: any) => m.kind === "image")?.id ??
              ""
            );
          }
        })();
      requireValue(model, 503, "当前没有可用的图片生成模型");
      const uid = body.uid || randomUUID();
      const draft = parseDraft(
        "image",
        {
          uid,
          prompt,
          refs: pack.media.slice(0, 4),
          ratio: body.ratio || "16:9",
          resolution: body.resolution || "2K",
          image_quality: body.image_quality || "high",
          model,
          asset_packs: [],
          price_revision: body.price_revision ?? null,
        },
        catalog,
      );
      const result = await this.generation.submitOn(
        sql,
        user,
        draft,
        String(workspace.public_id),
        body.price_revision ?? null,
      );
      return {
        mode: "generated" as const,
        job_id: result.id,
        prompt,
        pack,
      };
    });
  }
}
