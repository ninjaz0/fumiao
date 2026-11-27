import { canvasSourceKind } from "@fumiao/plugin-sdk/canvas-ports";
import {
  defaults,
  newNode,
  resolveNode,
  type CanvasEdge,
  type CanvasGenerationMode,
  type CanvasNode,
  type CinematographySpec,
  type DialogueLine,
  type Doc,
  type Job,
} from "./types";

export type ScriptAssetCategory = "character" | "scene" | "prop";

export type ScriptExtractedAsset = {
  key: string;
  code: string;
  name: string;
  category: ScriptAssetCategory;
  description: string;
  prompt: string;
  line: number;
};

export type ScriptExtractedScene = {
  code: string;
  heading: string;
  location: string;
  timeOfDay: string;
  interiorExterior: string;
  characters: string[];
  line: number;
};

export type ScriptExtractedShot = {
  anchor: string;
  shotId: string;
  fingerprint: string;
  actionSig: string;
  sceneCode: string;
  shotIndex: number;
  title: string;
  action: string;
  prompt: string;
  narration: string;
  seconds: 5 | 10 | 15;
  dialogues: { speaker: string; text: string }[];
  referencedAssets: string[];
  cinematography: CinematographySpec;
  lineStart: number;
  lineEnd: number;
};

export type ScriptBreakdown = {
  docId: string;
  docPath: string;
  title: string;
  assets: ScriptExtractedAsset[];
  scenes: ScriptExtractedScene[];
  shots: ScriptExtractedShot[];
};

export type ScriptSyncOptions = {
  includeAssets?: boolean;
  generationMode?: CanvasGenerationMode;
  gridLayout?: "2x2" | "3x3";
  tailChain?: boolean;
  videoModel?: string;
  imageModel?: string;
  ratio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9";
  selectedAnchors?: string[];
  explicitNodeBindings?: Record<string, string>;
  runs?: Job[];
  runsKnown?: boolean;
};

const ACTIVE_RUN_STATUSES = new Set([
  "queued",
  "running",
  "pending",
  "processing",
  "submitted",
]);

export function nodeHasOutputOrActiveRun(
  node: CanvasNode,
  runs: Job[] = [],
): boolean {
  if (node.media_id || node.active_job) return true;
  if (!runs.length) return false;
  const resolved = resolveNode(node, runs);
  if (resolved.media) return true;
  return resolved.list.some(
    (j) =>
      (j.status === "done" && Boolean(j.result)) ||
      ACTIVE_RUN_STATUSES.has(j.status),
  );
}

export type AmbiguousShotMatch = {
  existingVideoNodeId: string;
  existingTitle: string;
  previousAnchor: string;
  sceneCode: string;
  candidateAnchors: string[];
};

export type ScriptSyncResult = {
  document: Doc;
  createdNodeIds: string[];
  updatedNodeIds: string[];
  shotNodeIds: string[];
  anchorToNodeId: Record<string, string>;
};

export type ScriptAnchorLink = {
  anchor: string;
  shotId: string;
  videoNodeId: string;
  textNodeId: string | null;
  title: string;
  hasMedia: boolean;
  seconds: number;
};

export type CanvasNodeSearchMatch = {
  canvasId: string;
  canvasTitle: string;
  nodeId: string;
  nodeTitle: string;
  nodeType: CanvasNode["type"];
  field: "text" | "prompt";
  currentText: string;
  truncated: boolean;
  matches: {
    start: number;
    end: number;
    line: number;
    column: number;
    before: string;
    text: string;
    after: string;
  }[];
};

const SHOT_COMMENT_RE = /<!--\s*fm-shot:([a-zA-Z0-9_-]{3,64})\s*-->/g;
const SHOT_COMMENT_SINGLE_RE = /<!--\s*fm-shot:([a-zA-Z0-9_-]{3,64})\s*-->/;

export function stripShotCommentMarkers(text: string): string {
  return text.replace(SHOT_COMMENT_RE, "").replace(/\s{2,}/g, " ").trim();
}

function normalizeSig(text: string): string {
  return stripShotCommentMarkers(text)
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .slice(0, 160);
}

export function stampScriptShotIds(
  markdown: string,
  preferredLineByShotId: Record<string, number> = {},
): {
  markdown: string;
  changed: boolean;
} {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let changed = false;

  const idCounts = new Map<string, number>();
  for (const line of lines) {
    const m = line.match(SHOT_COMMENT_SINGLE_RE);
    if (m?.[1]) {
      idCounts.set(m[1], (idCounts.get(m[1]) ?? 0) + 1);
    }
  }
  const keptDuplicateIds = new Set<string>();
  let pendingIdForNextBeat = false;
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const trimmed = lines[i].trim();
    const match = trimmed.match(SHOT_COMMENT_SINGLE_RE);

    if (match && !/^[△▲]/.test(trimmed)) {
      const id = match[1];
      if ((idCounts.get(id) ?? 0) > 1) {
        const preferredLine = preferredLineByShotId[id];
        const keepHere =
          !keptDuplicateIds.has(id) &&
          (preferredLine === lineNum || preferredLine === lineNum + 1);
        if (keepHere) {
          keptDuplicateIds.add(id);
          out.push(lines[i]);
        } else {
          const freshId = `sh_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
          out.push(
            lines[i].replace(
              SHOT_COMMENT_SINGLE_RE,
              `<!-- fm-shot:${freshId} -->`,
            ),
          );
          changed = true;
        }
      } else {
        out.push(lines[i]);
      }
      pendingIdForNextBeat = true;
      continue;
    }

    if (/^[△▲]/.test(trimmed)) {
      if (!match && !pendingIdForNextBeat) {
        const shotUid = `sh_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
        out.push(`${lines[i]} <!-- fm-shot:${shotUid} -->`);
        changed = true;
      } else if (match) {
        const id = match[1];
        if ((idCounts.get(id) ?? 0) > 1) {
          const preferredLine = preferredLineByShotId[id];
          const keepHere =
            !keptDuplicateIds.has(id) && preferredLine === lineNum;
          if (keepHere) {
            keptDuplicateIds.add(id);
            out.push(lines[i]);
          } else {
            const freshId = `sh_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
            out.push(
              lines[i].replace(
                SHOT_COMMENT_SINGLE_RE,
                `<!-- fm-shot:${freshId} -->`,
              ),
            );
            changed = true;
          }
        } else {
          out.push(lines[i]);
        }
      } else {
        out.push(lines[i]);
      }
      pendingIdForNextBeat = false;
      continue;
    }
    if (/^#{1,4}\s+/.test(trimmed)) {
      pendingIdForNextBeat = false;
    }
    out.push(lines[i]);
  }
  return { markdown: out.join("\n"), changed };
}

export function resolvePreferredShotIdLines(
  doc: Doc,
  breakdown: ScriptBreakdown,
  explicitBindings: Record<string, string> = {},
  runs: Job[] = [],
  runsKnown = true,
): Record<string, number> {
  const plan = computeShotBindingPlan(
    doc.nodes,
    breakdown.docId,
    breakdown.shots,
    explicitBindings,
    runs,
    runsKnown,
  );
  const preferred: Record<string, number> = {};
  for (const shot of breakdown.shots) {
    const boundId = plan.anchorToVideoId.get(shot.anchor);
    if (!boundId) continue;
    const vNode = doc.nodes.find((n) => n.id === boundId && n.type === "video");
    const vShotId =
      typeof vNode?.extra_params?.script_shot_id === "string"
        ? vNode.extra_params.script_shot_id
        : "";
    if (vShotId) {
      preferred[vShotId] = shot.lineStart;
    }
  }
  return preferred;
}

function sanitizeIdPart(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.slice(0, 36) || "item";
}

function inferCinematography(text: string): CinematographySpec {
  const spec: CinematographySpec = {};
  if (/大特写|极特写/.test(text)) spec.shot_size = "大特写";
  else if (/特写/.test(text)) spec.shot_size = "特写";
  else if (/中近景/.test(text)) spec.shot_size = "中近景";
  else if (/近景/.test(text)) spec.shot_size = "近景";
  else if (/中景/.test(text)) spec.shot_size = "中景";
  else if (/远景/.test(text)) spec.shot_size = "远景";
  else if (/全景/.test(text)) spec.shot_size = "全景";

  if (/俯拍|鸟瞰/.test(text)) spec.camera_angle = "俯拍";
  else if (/仰拍|低角度/.test(text)) spec.camera_angle = "仰拍";
  else if (/过肩/.test(text)) spec.camera_angle = "过肩";
  else if (/主观|第一人称|POV/i.test(text)) spec.camera_angle = "主观视角";

  if (/缓推|推进|推镜|推近/.test(text)) spec.camera_movement = "推镜";
  else if (/拉远|拉镜|缓拉/.test(text)) spec.camera_movement = "拉镜";
  else if (/跟拍|跟随/.test(text)) spec.camera_movement = "跟拍";
  else if (/环绕/.test(text)) spec.camera_movement = "环绕";
  else if (/横摇|摇镜/.test(text)) spec.camera_movement = "摇镜";
  else if (/固定/.test(text)) spec.camera_movement = "固定镜头";

  if (/逆光|侧逆光/.test(text)) spec.lighting = "侧逆光";
  else if (/暖黄|暖光|钨丝灯/.test(text)) spec.lighting = "戏剧暖光";
  else if (/冷光|霓虹|暗调/.test(text)) spec.lighting = "暗调冷光";

  return spec;
}

function inferSeconds(
  action: string,
  dialogues: { speaker: string; text: string }[],
  explicitSeconds?: number,
): 5 | 10 | 15 {
  if (explicitSeconds === 5 || explicitSeconds === 10 || explicitSeconds === 15) {
    return explicitSeconds;
  }
  const dialogueChars = dialogues.reduce((sum, d) => sum + [...d.text].length, 0);
  const actionChars = [...action].length;
  if (dialogueChars > 36 || actionChars > 110) return 15;
  if (dialogueChars > 16 || actionChars > 55) return 10;
  return 5;
}

export function parseScriptBreakdown(
  markdown: string,
  docMeta: { docId?: string; docPath?: string } = {},
): ScriptBreakdown {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const docId = docMeta.docId || "local_script";
  const docPath = docMeta.docPath || "未命名剧本.md";

  let docTitle = docPath.split("/").at(-1)?.replace(/\.(md|markdown|txt)$/i, "") || "剧本";
  const assetsByKey = new Map<string, ScriptExtractedAsset>();
  const scenes: ScriptExtractedScene[] = [];
  const shots: ScriptExtractedShot[] = [];

  let sectionCategory: ScriptAssetCategory | null = null;
  let currentScene: ScriptExtractedScene | null = null;

  type PendingBeat = {
    shotId?: string;
    actions: string[];
    dialogues: { speaker: string; text: string }[];
    lineStart: number;
    lineEnd: number;
    explicitSeconds?: number;
  };
  let currentBeat: PendingBeat | null = null;
  let pendingCommentShotId: string | undefined = undefined;
  const sceneShotCounters = new Map<string, number>();

  const registerAsset = (
    category: ScriptAssetCategory,
    code: string,
    name: string,
    description: string,
    line: number,
  ) => {
    const cleanName = name.trim().replace(/^@+/, "");
    if (!cleanName || cleanName.length > 40) return;
    const key = `${category}:${cleanName}`;
    const existing = assetsByKey.get(key);
    if (existing) {
      if (!existing.description && description.trim()) {
        existing.description = description.trim();
        existing.prompt = buildAssetPrompt(category, cleanName, description.trim());
      }
      if (!existing.code && code) existing.code = code;
      return;
    }
    const autoCode =
      code ||
      `${category === "character" ? "CH" : category === "scene" ? "SC" : "PR"}${String(
        [...assetsByKey.values()].filter((a) => a.category === category).length + 1,
      ).padStart(2, "0")}`;
    const cleanDesc = description.trim();
    assetsByKey.set(key, {
      key,
      code: autoCode,
      name: cleanName,
      category,
      description: cleanDesc,
      prompt: buildAssetPrompt(category, cleanName, cleanDesc),
      line,
    });
  };

  function buildAssetPrompt(
    category: ScriptAssetCategory,
    name: string,
    desc: string,
  ): string {
    if (category === "character") {
      return desc
        ? `角色设定三视图（正面、侧面、背面）与面部特写：${name}，${desc}`
        : `角色设定三视图（正面、侧面、背面）与面部特写：${name}，写实电影质感，中性灰纯色背景，服装造型前后一致`;
    }
    if (category === "scene") {
      return desc
        ? `影视级空镜场景设定图（无人物）：${name}，${desc}`
        : `影视级空镜场景设定图（无人物）：${name}，空间纵深清晰，电影光影氛围`;
    }
    return desc
      ? `关键道具多角度设定图：${name}，${desc}`
      : `关键道具多角度设定图：${name}，细节清晰，写实材质质感`;
  }

  const flushBeat = () => {
    if (!currentBeat) return;
    if (!currentBeat.actions.length && !currentBeat.dialogues.length) {
      currentBeat = null;
      return;
    }
    const scene =
      currentScene ??
      (() => {
        const fallback: ScriptExtractedScene = {
          code: "S01",
          heading: "S01 默认场次",
          location: "",
          timeOfDay: "",
          interiorExterior: "",
          characters: [],
          line: currentBeat!.lineStart,
        };
        scenes.push(fallback);
        currentScene = fallback;
        return fallback;
      })();

    const count = (sceneShotCounters.get(scene.code) ?? 0) + 1;
    sceneShotCounters.set(scene.code, count);
    const anchor = `${scene.code}-${String(count).padStart(2, "0")}`;
    const actionText = stripShotCommentMarkers(currentBeat.actions.join(" "));
    const dialogues = currentBeat.dialogues;
    const actionSig = normalizeSig(actionText);
    const dlgSig = dialogues
      .map((d) => `${normalizeSig(d.speaker)}:${normalizeSig(d.text)}`)
      .join("|");
    const fingerprint = `${scene.code}|${actionSig}|${dlgSig}`.slice(0, 240);
    const explicitShotId = currentBeat.shotId || "";

    const referenced: string[] = [];
    if (scene.location) {
      const sceneKey = `scene:${scene.location}`;
      if (assetsByKey.has(sceneKey)) referenced.push(sceneKey);
    }
    for (const asset of assetsByKey.values()) {
      const combined =
        actionText +
        " " +
        dialogues.map((d) => `${d.speaker} ${d.text}`).join(" ");
      if (
        combined.includes(asset.name) ||
        (asset.code && combined.includes(asset.code))
      ) {
        if (!referenced.includes(asset.key)) referenced.push(asset.key);
      }
    }

    const cine = inferCinematography(actionText);
    const seconds = inferSeconds(
      actionText,
      dialogues,
      currentBeat.explicitSeconds,
    );

    const envPrefix = [scene.location, scene.timeOfDay, scene.interiorExterior]
      .filter(Boolean)
      .join(" · ");
    const dialogueSummary = dialogues
      .map((d) => `${d.speaker}说：“${d.text}”`)
      .join("；");
    const fullPrompt = [
      envPrefix ? `【场景：${envPrefix}】` : "",
      actionText || (dialogueSummary ? `${dialogues[0].speaker}说话镜头` : ""),
      dialogueSummary ? `对白表演：${dialogueSummary}` : "",
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 12000);

    const shortAction = (actionText || dialogueSummary || scene.heading)
      .replace(/^[△▲]\s*/, "")
      .replace(/[。！？，、；：].*$/, "")
      .trim()
      .slice(0, 28);

    const narration = dialogues.length
      ? dialogues
          .map((d) => `${d.speaker}：${d.text}`)
          .join(" ")
          .slice(0, 280)
      : "";

    shots.push({
      anchor,
      shotId: explicitShotId,
      fingerprint,
      actionSig,
      sceneCode: scene.code,
      shotIndex: count,
      title: `${anchor} ${shortAction || scene.location || "镜头"}`.slice(0, 76),
      action: actionText,
      prompt: fullPrompt,
      narration,
      seconds,
      dialogues,
      referencedAssets: referenced,
      cinematography: cine,
      lineStart: currentBeat.lineStart,
      lineEnd: currentBeat.lineEnd,
    });
    currentBeat = null;
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNo = idx + 1;
    const raw = lines[idx].trim();
    if (!raw || /^---+$/.test(raw)) {
      continue;
    }

    // Standalone persistent shot marker comment line: <!-- fm-shot:sh_xxx -->
    const standaloneShotComment = raw.match(
      /^<!--\s*fm-shot:([a-zA-Z0-9_-]{3,64})\s*-->$/,
    );
    if (standaloneShotComment) {
      pendingCommentShotId = standaloneShotComment[1];
      continue;
    }

    // Top-level H1 title
    const h1 = raw.match(/^#\s+(.+)$/);
    if (h1 && idx < 6) {
      docTitle = h1[1].replace(/[*_`]/g, "").trim().slice(0, 80) || docTitle;
      continue;
    }

    // Scene heading: e.g. "### S01 封闭密室 夜 内" or "S01 密室 夜 内" or "## 第1场 街头 夜 外"
    const sceneMatch =
      raw.match(
        /^(?:#{1,4}\s*)?(S\d{1,3}|SC\d{1,3}|第\s*\d+\s*场)\s+([^\n]+)$/i,
      ) ||
      raw.match(/^(?:#{2,4}\s*)(镜头\s*\d{1,3}|片段\s*[\d-]+)\s*(.*)$/);
    if (sceneMatch && !raw.startsWith("-")) {
      flushBeat();
      sectionCategory = null;
      const rawCode = sceneMatch[1].replace(/\s+/g, "").toUpperCase();
      const code = rawCode.startsWith("第")
        ? `S${String(scenes.length + 1).padStart(2, "0")}`
        : rawCode;
      const rest = (sceneMatch[2] || "").trim();
      const tokens = rest.split(/\s+/).filter(Boolean);
      const location = tokens[0] || rest || code;
      const timeOfDay =
        tokens.find((t) => /^(日|夜|晨|昏|傍晚|清晨|黄昏|白天)$/.test(t)) || "";
      const interiorExterior =
        tokens.find((t) => /^(内|外|内外|内景|外景)$/.test(t)) || "";

      if (location && !/^(镜头|片段)/.test(rawCode)) {
        registerAsset("scene", "", location, `${timeOfDay} ${interiorExterior}`.trim(), lineNo);
      }

      currentScene = {
        code,
        heading: `${code} ${rest}`.trim(),
        location,
        timeOfDay,
        interiorExterior,
        characters: [],
        line: lineNo,
      };
      scenes.push(currentScene);
      continue;
    }

    // Asset section headings
    if (/^#{1,4}\s*.*(角色资产|人物设定|角色设定|人物小传)/.test(raw)) {
      flushBeat();
      sectionCategory = "character";
      continue;
    }
    if (/^#{1,4}\s*.*(场景资产|环境设定|场景设定)/.test(raw)) {
      flushBeat();
      sectionCategory = "scene";
      continue;
    }
    if (/^#{1,4}\s*.*(关键道具|道具资产|道具设定)/.test(raw)) {
      flushBeat();
      sectionCategory = "prop";
      continue;
    }
    if (/^#{1,4}\s+/.test(raw)) {
      flushBeat();
      sectionCategory = null;
      continue;
    }

    // Markdown table row in shotlist: | 01 | S01 | 特写 / 缓推 | 5s | 画面... | 台词... |
    if (raw.startsWith("|") && raw.endsWith("|")) {
      const cells = raw
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim());
      if (
        cells.length >= 5 &&
        /^\d+$/.test(cells[0]) &&
        !/^-+$/.test(cells[1])
      ) {
        flushBeat();
        const scCode: string = /^S\d+/i.test(cells[1])
          ? cells[1].toUpperCase()
          : currentScene?.code || "S01";
        if (!scenes.some((s) => s.code === scCode)) {
          currentScene = {
            code: scCode,
            heading: scCode,
            location: "",
            timeOfDay: "",
            interiorExterior: "",
            characters: [],
            line: lineNo,
          };
          scenes.push(currentScene);
        }
        const secMatch = cells[3].match(/(5|10|15)/);
        const visual = `${cells[2] ? `【${cells[2]}】` : ""}${cells[4]}`.trim();
        const dlgCell = cells[5] || "";
        const dlgMatch = dlgCell.match(/^([^：:()（）]{1,20})[：:]\s*(.+)$/);
        currentBeat = {
          actions: [visual],
          dialogues: dlgMatch
            ? [{ speaker: dlgMatch[1].trim(), text: dlgMatch[2].trim() }]
            : [],
          lineStart: lineNo,
          lineEnd: lineNo,
          explicitSeconds: secMatch ? Number(secMatch[1]) : undefined,
        };
        flushBeat();
        continue;
      }
    }

    // Asset bullet item: - **CH01 齐夏**：25岁男性... or - **林墨（男主）**：...
    const bulletMatch = raw.match(
      /^[-*]\s+\*\*([^*]+)\*\*\s*[：:]\s*(.+)$/,
    );
    if (bulletMatch) {
      const head = bulletMatch[1].trim();
      const desc = bulletMatch[2].trim();
      const codeSplit = head.match(/^([A-Z]{2}\d{1,3})\s+(.+)$/i);
      const code = codeSplit ? codeSplit[1].toUpperCase() : "";
      const rawName = (codeSplit ? codeSplit[2] : head)
        .replace(/[（(][^）)]*[）)]/g, "")
        .trim();
      const inferredCategory: ScriptAssetCategory | null =
        sectionCategory ??
        (/^CH\d/i.test(code)
          ? "character"
          : /^SC\d/i.test(code)
            ? "scene"
            : /^PR\d/i.test(code)
              ? "prop"
              : /男主|女主|主角|反派|配角/.test(head)
                ? "character"
                : null);
      if (inferredCategory && rawName) {
        registerAsset(inferredCategory, code, rawName, desc, lineNo);
        continue;
      }
    }

    // Typed asset definition bullet: "- 角色：林默 — 28岁刑侦顾问..." or "- 场景：暗光审讯密室 — 混凝土密闭空间..."
    const typedAssetBullet = raw.match(
      /^[-*]\s*(?:\*\*)?(角色|人物|场景|道具)(?:\*\*)?\s*[：:]\s*([^\s—–\-：:]{1,24})\s*(?:[—–\-]+|[：:])\s*(.+)$/,
    );
    if (typedAssetBullet) {
      const cat: ScriptAssetCategory =
        typedAssetBullet[1] === "场景"
          ? "scene"
          : typedAssetBullet[1] === "道具"
            ? "prop"
            : "character";
      registerAsset(
        cat,
        "",
        typedAssetBullet[2].replace(/^@+/, "").trim(),
        typedAssetBullet[3].trim(),
        lineNo,
      );
      continue;
    }

    // Cast line inside a scene: "人物：齐夏、人羊、甜甜" or "出场资产：@林墨、@苏晚"
    const castMatch = raw.match(
      /^(?:[-*]\s*)?(?:\*\*)?(?:人物|出场人物|角色|出场资产)(?:\*\*)?\s*[：:]\s*(.+)$/,
    );
    if (castMatch) {
      const namesList = castMatch[1]
        .split(/[、，,/\s]+/)
        .map((s) => s.replace(/^@+/, "").trim())
        .filter(Boolean);
      for (const n of namesList) {
        if (/密室|街道|大厅|房间|古镇|天台|办公室/.test(n)) {
          registerAsset("scene", "", n, "", lineNo);
        } else if (/座钟|怀表|匕首|信封|钥匙/.test(n)) {
          registerAsset("prop", "", n, "", lineNo);
        } else {
          registerAsset("character", "", n, "", lineNo);
          if (currentScene && !currentScene.characters.includes(n)) {
            currentScene.characters.push(n);
          }
        }
      }
      continue;
    }

    // Action line starting with △ or ▲: starts a new visual beat if previous beat already has dialogue or action!
    if (/^[△▲]/.test(raw)) {
      const inlineComment = raw.match(SHOT_COMMENT_SINGLE_RE);
      const cleanRaw = raw.replace(SHOT_COMMENT_RE, "").trim();
      const segments = cleanRaw
        .split(/(?=[△▲])/)
        .map((s) => s.replace(/^[△▲]\s*/, "").trim())
        .filter(Boolean);
      if (currentBeat && (currentBeat.dialogues.length > 0 || currentBeat.actions.length > 0)) {
        flushBeat();
      }
      if (!currentBeat) {
        currentBeat = {
          shotId: inlineComment?.[1] || pendingCommentShotId,
          actions: [],
          dialogues: [],
          lineStart: lineNo,
          lineEnd: lineNo,
        };
        pendingCommentShotId = undefined;
      } else if (!currentBeat.shotId && (inlineComment?.[1] || pendingCommentShotId)) {
        currentBeat.shotId = inlineComment?.[1] || pendingCommentShotId;
        pendingCommentShotId = undefined;
      }
      currentBeat.actions.push(...segments);
      currentBeat.lineEnd = lineNo;
      continue;
    }

    // Dialogue line: "齐夏：手机和证件都被收走了..." (excluding metadata bullets like "规格：...")
    const dialogueMatch = raw.match(
      /^([^：:*#\-|<>]{1,18})[：:]\s*[“"「]?(.+?)[”"」]?$/,
    );
    if (
      dialogueMatch &&
      !/^(规格|依据|场号|压缩原则|画幅|画幅与时长|核心钩子|备注|注意|时间|地点|景别|时长)$/.test(
        dialogueMatch[1].trim(),
      )
    ) {
      const speaker = dialogueMatch[1]
        .replace(/[（(][^）)]*[）)]/g, "")
        .trim();
      const speech = dialogueMatch[2].trim();
      if (speaker && speech) {
        registerAsset("character", "", speaker, "", lineNo);
        if (!currentBeat) {
          currentBeat = {
            actions: [],
            dialogues: [],
            lineStart: lineNo,
            lineEnd: lineNo,
          };
        }
        currentBeat.dialogues.push({
          speaker: speaker.slice(0, 40),
          text: speech.slice(0, 300),
        });
        currentBeat.lineEnd = lineNo;
        // Keep up to 2 dialogue turns per shot beat for natural pacing
        if (currentBeat.dialogues.length >= 2) {
          flushBeat();
        }
        continue;
      }
    }
  }

  flushBeat();

  return {
    docId,
    docPath,
    title: docTitle,
    assets: [...assetsByKey.values()],
    scenes,
    shots,
  };
}

export function syncScriptBreakdownToCanvas(
  doc: Doc,
  breakdown: ScriptBreakdown,
  options: ScriptSyncOptions = {},
): ScriptSyncResult {
  const includeAssets = options.includeAssets ?? true;
  const generationMode = options.generationMode ?? "first_last_frame";
  const isGridPreview = generationMode === "grid_preview";
  const gridLayout = options.gridLayout ?? "3x3";
  const tailChain = options.tailChain ?? true;
  const ratio = options.ratio ?? "16:9";
  const videoModel = options.videoModel ?? "MiniMax H3";
  const imageModel = options.imageModel ?? "";
  const runs = options.runs ?? [];
  const runsKnown = options.runsKnown ?? true;

  const selectedSet = options.selectedAnchors
    ? new Set(options.selectedAnchors)
    : null;
  const activeShots = selectedSet
    ? breakdown.shots.filter((s) => selectedSet.has(s.anchor))
    : breakdown.shots;

  const nextNodes: CanvasNode[] = doc.nodes.map((n) => structuredClone(n));
  const nextEdges: CanvasEdge[] = doc.edges.map((e) => structuredClone(e));
  const nextShots: string[] = [...(doc.shots ?? [])];

  const createdNodeIds: string[] = [];
  const updatedNodeIds: string[] = [];
  const shotNodeIds: string[] = [];
  const anchorToNodeId: Record<string, string> = {};

  // Determine base layout origin if creating fresh nodes
  const existingNonScriptMaxX = nextNodes.length
    ? Math.max(...nextNodes.map((n) => n.x + n.width))
    : 0;
  const hasExistingForDoc = nextNodes.some(
    (n) => n.extra_params?.script_doc_id === breakdown.docId,
  );
  const originX =
    nextNodes.length === 0 || hasExistingForDoc ? 60 : existingNonScriptMaxX + 160;
  const assetColumnX = originX;
  const shotStartX = includeAssets && breakdown.assets.length > 0 ? originX + 440 : originX;

  // 1. Sync Asset Reference Image Nodes (Characters / Scenes / Props)
  const assetKeyToNodeId = new Map<string, string>();
  const claimedAssetNodeIds = new Set<string>();
  if (includeAssets) {
    const isCandidateAssetImage = (n: CanvasNode) =>
      n.type === "image" &&
      !claimedAssetNodeIds.has(n.id) &&
      n.generation_mode !== "grid_preview" &&
      n.extra_params?.script_role !== "grid_preview";
    breakdown.assets.forEach((asset, idx) => {
      const expectedTitle = `资产 · ${asset.code} ${asset.name}`.slice(0, 80);
      const existing =
        nextNodes.find(
          (n) =>
            isCandidateAssetImage(n) &&
            n.extra_params?.script_asset_key === asset.key,
        ) ??
        nextNodes.find(
          (n) =>
            isCandidateAssetImage(n) &&
            !n.extra_params?.script_asset_key &&
            (n.title.trim() === expectedTitle || n.title.trim() === asset.name),
        );

      if (existing) {
        claimedAssetNodeIds.add(existing.id);
        assetKeyToNodeId.set(asset.key, existing.id);
        const nextPrompt = (existing.prompt ?? "").trim()
          ? existing.prompt
          : asset.prompt;
        const nextExtra = {
          ...(existing.extra_params ?? {}),
          script_doc_id: breakdown.docId,
          script_doc_path: breakdown.docPath,
          script_asset_key: asset.key,
          script_asset_category: asset.category,
          script_line: asset.line,
        };
        if (
          existing.prompt !== nextPrompt ||
          existing.extra_params?.script_asset_key !== asset.key
        ) {
          existing.prompt = nextPrompt;
          existing.extra_params = nextExtra;
          updatedNodeIds.push(existing.id);
        }
      } else if (nextNodes.length < 390) {
        const created = newNode(
          "image",
          assetColumnX,
          60 + idx * 300,
          nextNodes.length + 1,
        );
        created.id = `asset_${sanitizeIdPart(asset.code)}_${crypto.randomUUID().slice(0, 8)}`;
        created.title = expectedTitle;
        created.prompt = asset.prompt.slice(0, 12000);
        created.color =
          asset.category === "character"
            ? "mint"
            : asset.category === "scene"
              ? "blue"
              : "orange";
        created.params = {
          ...defaults,
          ratio: asset.category === "character" ? "16:9" : ratio,
          ...(imageModel ? { model: imageModel } : {}),
        };
        created.extra_params = {
          script_doc_id: breakdown.docId,
          script_doc_path: breakdown.docPath,
          script_asset_key: asset.key,
          script_asset_category: asset.category,
          script_line: asset.line,
        };
        nextNodes.push(created);
        createdNodeIds.push(created.id);
        assetKeyToNodeId.set(asset.key, created.id);
      }
    });
  }

  const isImageSource = (
    node: CanvasNode | undefined,
    port?: string,
  ): boolean => Boolean(node && canvasSourceKind(node, port) === "image");

  const countProjectedImageRefs = (
    targetId: string,
    desiredSet: ReadonlySet<string>,
    managedSet: ReadonlySet<string>,
  ): number => {
    const manualSources = new Set<string>();
    let count = 0;
    for (const e of nextEdges) {
      if (e.target !== targetId) continue;
      if (managedSet.has(`${e.source}>${e.target}`)) continue;
      const srcNode = nextNodes.find((n) => n.id === e.source);
      if (isImageSource(srcNode, e.sourcePort)) {
        count++;
        manualSources.add(e.source);
      }
    }
    for (const pair of desiredSet) {
      const [src, tgt] = pair.split(">");
      if (tgt !== targetId || manualSources.has(src)) continue;
      const srcNode = nextNodes.find((n) => n.id === src);
      if (isImageSource(srcNode)) {
        count++;
      }
    }
    return count;
  };

  // Only returns a managed pair key if the edge was newly created by sync OR was already in prevManagedSet.
  // Pre-existing manual user edges are left intact and NEVER claimed as script-managed!
  const ensureManagedEdge = (
    source: string,
    target: string,
    prevManagedSet?: ReadonlySet<string>,
  ): string | null => {
    if (source === target) return null;
    const pairKey = `${source}>${target}`;
    const existing = nextEdges.find(
      (e) => e.source === source && e.target === target,
    );
    if (existing) {
      return prevManagedSet?.has(pairKey) ? pairKey : null;
    }
    if (nextEdges.length >= 1200) return null;
    const sourceNode = nextNodes.find((n) => n.id === source);
    if (isImageSource(sourceNode)) {
      const existingImageRefs = nextEdges.filter((e) => {
        if (e.target !== target) return false;
        const s = nextNodes.find((n) => n.id === e.source);
        return isImageSource(s, e.sourcePort);
      }).length;
      if (existingImageRefs >= 9) return null;
    }
    nextEdges.push({
      id: `edge_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
      source,
      target,
    });
    return pairKey;
  };

  // Compute binding plan across the full breakdown so partial selection never shifts scene positions
  const bindingPlan = computeShotBindingPlan(
    nextNodes,
    breakdown.docId,
    breakdown.shots,
    options.explicitNodeBindings ?? {},
    runs,
    runsKnown,
  );

  const scriptShotIdTotals = new Map<string, number>();
  for (const s of breakdown.shots) {
    if (s.shotId) {
      scriptShotIdTotals.set(
        s.shotId,
        (scriptShotIdTotals.get(s.shotId) ?? 0) + 1,
      );
    }
  }
  const duplicateScriptShotIds = new Set<string>(
    [...scriptShotIdTotals.entries()]
      .filter(([, count]) => count > 1)
      .map(([id]) => id),
  );

  // Track assigned shotIds across all canvas video nodes so duplicate script lines never share a shotId on canvas
  const assignedShotIds = new Set<string>();
  const matchedExistingIds = new Set(bindingPlan.anchorToVideoId.values());
  for (const n of nextNodes) {
    if (
      n.type === "video" &&
      !matchedExistingIds.has(n.id) &&
      typeof n.extra_params?.script_shot_id === "string" &&
      n.extra_params.script_shot_id
    ) {
      assignedShotIds.add(n.extra_params.script_shot_id);
    }
  }
  const allocateUniqueShotId = (preferred?: string): string => {
    if (preferred && !assignedShotIds.has(preferred)) {
      assignedShotIds.add(preferred);
      return preferred;
    }
    let fresh = `sh_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
    while (assignedShotIds.has(fresh)) {
      fresh = `sh_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
    }
    assignedShotIds.add(fresh);
    return fresh;
  };

  // 2. Sync Shot Chains (Text Prompt Node + Optional Grid Image + Video Shot Node)
  activeShots.forEach((shot, index) => {
    const dialogueLines: DialogueLine[] = shot.dialogues.map((d, dIdx) => ({
      id: `dlg_${sanitizeIdPart(shot.anchor)}_${dIdx + 1}`,
      speaker: d.speaker.slice(0, 40),
      text: d.text.slice(0, 300),
    }));

    const matchedVideoId = bindingPlan.anchorToVideoId.get(shot.anchor);
    const existingVideo = matchedVideoId
      ? nextNodes.find((n) => n.id === matchedVideoId && n.type === "video")
      : undefined;

    if (existingVideo) {
      const prevAnchor =
        typeof existingVideo.extra_params?.script_anchor === "string"
          ? existingVideo.extra_params.script_anchor
          : "";
      const prevShotId =
        typeof existingVideo.extra_params?.script_shot_id === "string"
          ? existingVideo.extra_params.script_shot_id
          : "";
      const prevManagedRaw =
        typeof existingVideo.extra_params?.script_managed_edges === "string"
          ? existingVideo.extra_params.script_managed_edges
          : "";
      const prevManagedSet = new Set(
        prevManagedRaw.split("|").map((s) => s.trim()).filter(Boolean),
      );
      const preferredShotId =
        shot.shotId && !duplicateScriptShotIds.has(shot.shotId)
          ? shot.shotId
          : prevShotId || shot.shotId;
      const effectiveShotId = allocateUniqueShotId(preferredShotId);

      let existingText = nextNodes.find(
        (n) =>
          n.type === "text" &&
          n.extra_params?.script_doc_id === breakdown.docId &&
          ((prevShotId && n.extra_params?.script_shot_id === prevShotId) ||
            (!prevShotId && prevAnchor && n.extra_params?.script_anchor === prevAnchor)),
      );
      if (!existingText && nextNodes.length < 399) {
        const createdText = newNode(
          "text",
          existingVideo.x,
          Math.max(40, existingVideo.y - 320),
          nextNodes.length + 1,
        );
        createdText.id = `scr_${sanitizeIdPart(shot.anchor)}_${crypto.randomUUID().slice(0, 6)}`;
        createdText.title = `${shot.title} · 剧本提示词`.slice(0, 80);
        createdText.text = shot.prompt;
        createdText.color = "purple";
        createdText.extra_params = {
          script_doc_id: breakdown.docId,
          script_doc_path: breakdown.docPath,
          script_shot_id: effectiveShotId,
          script_anchor: shot.anchor,
          script_line: shot.lineStart,
        };
        nextNodes.push(createdText);
        createdNodeIds.push(createdText.id);
        existingText = createdText;
      } else if (existingText) {
        const nextTitle = `${shot.title} · 剧本提示词`.slice(0, 80);
        const textChanged =
          existingText.text !== shot.prompt || existingText.title !== nextTitle;
        existingText.text = shot.prompt;
        existingText.title = nextTitle;
        existingText.extra_params = {
          ...(existingText.extra_params ?? {}),
          script_doc_id: breakdown.docId,
          script_doc_path: breakdown.docPath,
          script_shot_id: effectiveShotId,
          script_anchor: shot.anchor,
          script_line: shot.lineStart,
        };
        if (textChanged) updatedNodeIds.push(existingText.id);
      }

      let existingGrid = nextNodes.find(
        (n) =>
          n.type === "image" &&
          n.extra_params?.script_doc_id === breakdown.docId &&
          (n.extra_params?.script_role === "grid_preview" ||
            n.generation_mode === "grid_preview") &&
          ((prevShotId && n.extra_params?.script_shot_id === prevShotId) ||
            (!prevShotId && prevAnchor && n.extra_params?.script_anchor === prevAnchor)),
      );

      if (isGridPreview) {
        if (!existingGrid && nextNodes.length < 399) {
          existingGrid = newNode(
            "image",
            existingVideo.x,
            Math.max(120, existingVideo.y - 260),
            nextNodes.length + 1,
          );
          existingGrid.id = `grid_${sanitizeIdPart(shot.anchor)}_${crypto.randomUUID().slice(0, 6)}`;
          existingGrid.title = `${shot.title} · 宫格预览`.slice(0, 80);
          existingGrid.prompt = shot.prompt;
          existingGrid.generation_mode = "grid_preview";
          existingGrid.grid_layout = gridLayout;
          existingGrid.params = {
            ...defaults,
            ratio,
            ...(imageModel ? { model: imageModel } : {}),
          };
          existingGrid.extra_params = {
            script_doc_id: breakdown.docId,
            script_doc_path: breakdown.docPath,
            script_shot_id: effectiveShotId,
            script_role: "grid_preview",
            script_anchor: shot.anchor,
            script_line: shot.lineStart,
          };
          nextNodes.push(existingGrid);
          createdNodeIds.push(existingGrid.id);
        } else if (existingGrid) {
          const nextGridTitle = `${shot.title} · 宫格预览`.slice(0, 80);
          const gridChanged =
            existingGrid.prompt !== shot.prompt ||
            existingGrid.title !== nextGridTitle ||
            existingGrid.grid_layout !== gridLayout;
          existingGrid.title = nextGridTitle;
          existingGrid.prompt = shot.prompt;
          existingGrid.generation_mode = "grid_preview";
          existingGrid.grid_layout = gridLayout;
          existingGrid.extra_params = {
            ...(existingGrid.extra_params ?? {}),
            script_doc_id: breakdown.docId,
            script_doc_path: breakdown.docPath,
            script_shot_id: effectiveShotId,
            script_role: "grid_preview",
            script_anchor: shot.anchor,
            script_line: shot.lineStart,
          };
          if (gridChanged) updatedNodeIds.push(existingGrid.id);
        }
      } else if (
        existingGrid &&
        runsKnown &&
        !nodeHasOutputOrActiveRun(existingGrid, runs)
      ) {
        const gridIdCandidate = existingGrid.id;
        const hasManualEdgesOnGrid = nextEdges.some(
          (e) =>
            (e.source === gridIdCandidate || e.target === gridIdCandidate) &&
            !prevManagedSet.has(`${e.source}>${e.target}`),
        );
        if (!hasManualEdgesOnGrid) {
          const gIdx = nextNodes.findIndex((n) => n.id === gridIdCandidate);
          if (gIdx >= 0) nextNodes.splice(gIdx, 1);
          for (let eIdx = nextEdges.length - 1; eIdx >= 0; eIdx--) {
            if (
              nextEdges[eIdx].source === gridIdCandidate ||
              nextEdges[eIdx].target === gridIdCandidate
            ) {
              nextEdges.splice(eIdx, 1);
            }
          }
          existingGrid = undefined;
        }
      }

      // Preserve audio_job / audio_pending when speaker + text unchanged, update changed lines
      const prevDlg = existingVideo.dialogue_lines ?? [];
      const mergedDlg: DialogueLine[] = dialogueLines.map((line, i) => {
        const prev = prevDlg[i];
        if (prev && prev.speaker === line.speaker && prev.text === line.text) {
          return prev;
        }
        return {
          ...line,
          voice_id: prev?.voice_id,
          pack_id: prev?.pack_id,
          model: prev?.model,
        };
      });

      const desiredManagedPairs = new Set<string>();
      if (isGridPreview && existingGrid) {
        if (existingText) desiredManagedPairs.add(`${existingText.id}>${existingGrid.id}`);
        if (
          countProjectedImageRefs(
            existingVideo.id,
            desiredManagedPairs,
            prevManagedSet,
          ) < 9
        ) {
          desiredManagedPairs.add(`${existingGrid.id}>${existingVideo.id}`);
        }
        for (const assetKey of shot.referencedAssets) {
          const assetNodeId = assetKeyToNodeId.get(assetKey);
          if (
            assetNodeId &&
            countProjectedImageRefs(
              existingGrid.id,
              desiredManagedPairs,
              prevManagedSet,
            ) < 9
          ) {
            desiredManagedPairs.add(`${assetNodeId}>${existingGrid.id}`);
          }
        }
      } else {
        if (existingText) desiredManagedPairs.add(`${existingText.id}>${existingVideo.id}`);
        // Preserve existing grid edges FIRST (before adding new asset refs) when existingGrid is retained,
        // so uncertain /runs state never drops an existing grid->video connection due to referencedAssets count!
        if (existingGrid) {
          for (const pair of prevManagedSet) {
            const [src, tgt] = pair.split(">");
            if (tgt === existingGrid.id) {
              desiredManagedPairs.add(pair);
            } else if (
              !runsKnown &&
              src === existingGrid.id &&
              countProjectedImageRefs(
                tgt,
                desiredManagedPairs,
                prevManagedSet,
              ) < 9
            ) {
              desiredManagedPairs.add(pair);
            }
          }
        }
        // Fill remaining image reference capacity with resolved asset image nodes
        for (const assetKey of shot.referencedAssets) {
          const assetNodeId = assetKeyToNodeId.get(assetKey);
          if (!assetNodeId) continue;
          if (
            countProjectedImageRefs(
              existingVideo.id,
              desiredManagedPairs,
              prevManagedSet,
            ) >= 9
          ) {
            break;
          }
          desiredManagedPairs.add(`${assetNodeId}>${existingVideo.id}`);
        }
      }

      // Prune edges that were previously created by script sync for this shot but are no longer desired
      for (let eIdx = nextEdges.length - 1; eIdx >= 0; eIdx--) {
        const pair = `${nextEdges[eIdx].source}>${nextEdges[eIdx].target}`;
        if (prevManagedSet.has(pair) && !desiredManagedPairs.has(pair)) {
          nextEdges.splice(eIdx, 1);
        }
      }

      const activeManagedPairs: string[] = [];
      for (const pair of desiredManagedPairs) {
        const [src, tgt] = pair.split(">");
        const added = ensureManagedEdge(src, tgt, prevManagedSet);
        if (added) activeManagedPairs.push(added);
      }

      const changed =
        existingVideo.title !== shot.title ||
        existingVideo.narration_text !== shot.narration ||
        existingVideo.extra_params?.script_anchor !== shot.anchor ||
        existingVideo.extra_params?.script_shot_id !== effectiveShotId ||
        JSON.stringify(existingVideo.dialogue_lines ?? []) !==
          JSON.stringify(mergedDlg);

      existingVideo.title = shot.title;
      existingVideo.narration_text = shot.narration;
      existingVideo.dialogue_lines = mergedDlg;
      existingVideo.generation_mode = isGridPreview ? "first_frame" : generationMode;
      existingVideo.cinematography = {
        ...shot.cinematography,
        ...(existingVideo.cinematography ?? {}),
      };
      existingVideo.extra_params = {
        ...(existingVideo.extra_params ?? {}),
        script_doc_id: breakdown.docId,
        script_doc_path: breakdown.docPath,
        script_shot_id: effectiveShotId,
        script_fingerprint: shot.fingerprint,
        script_action_sig: shot.actionSig,
        script_scene_code: shot.sceneCode,
        script_anchor: shot.anchor,
        script_line: shot.lineStart,
        script_managed_edges: activeManagedPairs.join("|").slice(0, 2000),
      };
      if (changed) updatedNodeIds.push(existingVideo.id);

      shotNodeIds.push(existingVideo.id);
      anchorToNodeId[shot.anchor] = existingVideo.id;
      return;
    }

    const neededNodes = isGridPreview ? 3 : 2;
    if (nextNodes.length + neededNodes > 400) return;

    const effectiveShotId = allocateUniqueShotId(shot.shotId);
    const colX = shotStartX + index * 420;
    const textNode = newNode("text", colX, 60, nextNodes.length + 1);
    textNode.id = `scr_${sanitizeIdPart(shot.anchor)}_${crypto.randomUUID().slice(0, 6)}`;
    textNode.title = `${shot.title} · 剧本提示词`.slice(0, 80);
    textNode.text = shot.prompt;
    textNode.color = "purple";
    textNode.extra_params = {
      script_doc_id: breakdown.docId,
      script_doc_path: breakdown.docPath,
      script_shot_id: effectiveShotId,
      script_anchor: shot.anchor,
      script_line: shot.lineStart,
    };
    nextNodes.push(textNode);
    createdNodeIds.push(textNode.id);

    let gridNode: CanvasNode | null = null;
    if (isGridPreview) {
      gridNode = newNode("image", colX, 350, nextNodes.length + 1);
      gridNode.id = `grid_${sanitizeIdPart(shot.anchor)}_${crypto.randomUUID().slice(0, 6)}`;
      gridNode.title = `${shot.title} · 宫格预览`.slice(0, 80);
      gridNode.prompt = shot.prompt;
      gridNode.generation_mode = "grid_preview";
      gridNode.grid_layout = gridLayout;
      gridNode.params = {
        ...defaults,
        ratio,
        ...(imageModel ? { model: imageModel } : {}),
      };
      gridNode.extra_params = {
        script_doc_id: breakdown.docId,
        script_doc_path: breakdown.docPath,
        script_shot_id: effectiveShotId,
        script_role: "grid_preview",
        script_anchor: shot.anchor,
        script_line: shot.lineStart,
      };
      nextNodes.push(gridNode);
      createdNodeIds.push(gridNode.id);
    }

    const videoNode = newNode(
      "video",
      colX,
      isGridPreview ? 650 : 380,
      nextNodes.length + 1,
    );
    videoNode.id = `shot_${sanitizeIdPart(shot.anchor)}_${crypto.randomUUID().slice(0, 6)}`;
    videoNode.title = shot.title;
    videoNode.narration_text = shot.narration;
    videoNode.dialogue_lines = dialogueLines;
    videoNode.cinematography = shot.cinematography;
    videoNode.generation_mode = isGridPreview ? "first_frame" : generationMode;
    if (tailChain && index > 0) {
      videoNode.tail_inherited = true;
    }
    videoNode.params = {
      ...defaults,
      model: videoModel,
      ratio,
      seconds: shot.seconds,
    };

    const managedPairs: string[] = [];
    if (gridNode) {
      const p1 = ensureManagedEdge(textNode.id, gridNode.id);
      const p2 = ensureManagedEdge(gridNode.id, videoNode.id);
      if (p1) managedPairs.push(p1);
      if (p2) managedPairs.push(p2);
    } else {
      const p1 = ensureManagedEdge(textNode.id, videoNode.id);
      if (p1) managedPairs.push(p1);
    }

    for (const assetKey of shot.referencedAssets) {
      const assetNodeId = assetKeyToNodeId.get(assetKey);
      if (assetNodeId) {
        const pRef = ensureManagedEdge(
          assetNodeId,
          gridNode ? gridNode.id : videoNode.id,
        );
        if (pRef) managedPairs.push(pRef);
      }
    }

    videoNode.extra_params = {
      script_doc_id: breakdown.docId,
      script_doc_path: breakdown.docPath,
      script_shot_id: effectiveShotId,
      script_fingerprint: shot.fingerprint,
      script_action_sig: shot.actionSig,
      script_scene_code: shot.sceneCode,
      script_anchor: shot.anchor,
      script_line: shot.lineStart,
      script_managed_edges: managedPairs.join("|").slice(0, 2000),
    };
    nextNodes.push(videoNode);
    createdNodeIds.push(videoNode.id);

    shotNodeIds.push(videoNode.id);
    anchorToNodeId[shot.anchor] = videoNode.id;
  });

  // Maintain shot list: partial sync updates existing shots in-place and inserts newly-created shots
  // next to their script neighbors; full sync orders this script's shots in script sequence in-place.
  const isPartialSync = activeShots.length < breakdown.shots.length;
  let orderedShots: string[];
  if (isPartialSync) {
    const merged = [...nextShots];
    const resolveKnownVideoId = (anchor: string): string | undefined =>
      anchorToNodeId[anchor] ?? bindingPlan.anchorToVideoId.get(anchor);

    for (let sIdx = 0; sIdx < breakdown.shots.length; sIdx++) {
      const anchor = breakdown.shots[sIdx].anchor;
      const vidId = anchorToNodeId[anchor];
      if (!vidId || merged.includes(vidId)) continue;

      let inserted = false;
      for (let prev = sIdx - 1; prev >= 0; prev--) {
        const prevVid = resolveKnownVideoId(breakdown.shots[prev].anchor);
        const pos = prevVid ? merged.indexOf(prevVid) : -1;
        if (pos >= 0) {
          merged.splice(pos + 1, 0, vidId);
          inserted = true;
          break;
        }
      }
      if (!inserted) {
        for (let nxt = sIdx + 1; nxt < breakdown.shots.length; nxt++) {
          const nextVid = resolveKnownVideoId(breakdown.shots[nxt].anchor);
          const pos = nextVid ? merged.indexOf(nextVid) : -1;
          if (pos >= 0) {
            merged.splice(pos, 0, vidId);
            inserted = true;
            break;
          }
        }
      }
      if (!inserted) merged.push(vidId);
    }
    orderedShots = merged.slice(0, 200);
  } else {
    const syncedSet = new Set(shotNodeIds);
    const firstExistingIdx = nextShots.findIndex((id) => syncedSet.has(id));
    if (firstExistingIdx < 0) {
      orderedShots = [...nextShots, ...shotNodeIds].slice(0, 200);
    } else {
      const before = nextShots
        .slice(0, firstExistingIdx)
        .filter((id) => !syncedSet.has(id));
      const after = nextShots
        .slice(firstExistingIdx + 1)
        .filter((id) => !syncedSet.has(id));
      orderedShots = [...before, ...shotNodeIds, ...after].slice(0, 200);
    }
  }

  return {
    document: {
      ...doc,
      nodes: nextNodes,
      edges: nextEdges,
      shots: orderedShots,
    },
    createdNodeIds,
    updatedNodeIds,
    shotNodeIds,
    anchorToNodeId,
  };
}

function computeShotBindingPlan(
  nodes: CanvasNode[],
  docId: string,
  shots: ScriptExtractedShot[],
  explicitBindings: Record<string, string> = {},
  runs: Job[] = [],
  runsKnown = true,
): {
  anchorToVideoId: Map<string, string>;
  unmatchedMediaNodes: CanvasNode[];
} {
  const existingVideos = nodes.filter(
    (n) => n.type === "video" && n.extra_params?.script_doc_id === docId,
  );
  const claimedVideoIds = new Set<string>();
  const anchorToVideoId = new Map<string, string>();

  // Detect duplicate shotIds in script (e.g. copy-pasted line in source mode) and on canvas
  const scriptShotIdCounts = new Map<string, number>();
  for (const s of shots) {
    if (s.shotId) {
      scriptShotIdCounts.set(
        s.shotId,
        (scriptShotIdCounts.get(s.shotId) ?? 0) + 1,
      );
    }
  }
  const duplicateScriptShotIds = new Set<string>(
    [...scriptShotIdCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([id]) => id),
  );

  const canvasShotIdCounts = new Map<string, number>();
  for (const v of existingVideos) {
    const vidShotId =
      typeof v.extra_params?.script_shot_id === "string"
        ? v.extra_params.script_shot_id
        : "";
    if (vidShotId) {
      canvasShotIdCounts.set(
        vidShotId,
        (canvasShotIdCounts.get(vidShotId) ?? 0) + 1,
      );
    }
  }
  const duplicateCanvasShotIds = new Set<string>(
    [...canvasShotIdCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([id]) => id),
  );

  const existingSceneCounts = new Map<string, number>();
  for (const v of existingVideos) {
    const sc =
      typeof v.extra_params?.script_scene_code === "string"
        ? v.extra_params.script_scene_code
        : typeof v.extra_params?.script_anchor === "string"
          ? v.extra_params.script_anchor.split("-")[0]
          : "";
    if (sc) existingSceneCounts.set(sc, (existingSceneCounts.get(sc) ?? 0) + 1);
  }
  const currentSceneCounts = new Map<string, number>();
  for (const s of shots) {
    currentSceneCounts.set(
      s.sceneCode,
      (currentSceneCounts.get(s.sceneCode) ?? 0) + 1,
    );
  }

  const isIdentityCompatible = (
    s: ScriptExtractedShot,
    v: CanvasNode,
  ): boolean => {
    const vShotId =
      typeof v.extra_params?.script_shot_id === "string"
        ? v.extra_params.script_shot_id
        : "";
    if (!s.shotId || !vShotId) return true;
    if (s.shotId === vShotId) return true;
    // Allow content match ONLY if s.shotId was duplicated from copy-paste; two distinct unique shotIds never auto-merge!
    return duplicateScriptShotIds.has(s.shotId);
  };

  // Pass 1a: Explicit user confirmation bindings
  for (const s of shots) {
    const explicitId = explicitBindings[s.anchor];
    if (explicitId && !claimedVideoIds.has(explicitId)) {
      const found = existingVideos.find((v) => v.id === explicitId);
      if (found) {
        claimedVideoIds.add(found.id);
        anchorToVideoId.set(s.anchor, found.id);
      }
    }
  }

  // Pass 1b: Unique persistent shotId (skipped when duplicated in script or canvas so copy-pasted lines never steal media)
  for (const s of shots) {
    if (anchorToVideoId.has(s.anchor) || !s.shotId) continue;
    if (
      duplicateScriptShotIds.has(s.shotId) ||
      duplicateCanvasShotIds.has(s.shotId)
    ) {
      continue;
    }
    const candidates = existingVideos.filter(
      (v) =>
        !claimedVideoIds.has(v.id) &&
        v.extra_params?.script_shot_id === s.shotId,
    );
    if (candidates.length === 1) {
      claimedVideoIds.add(candidates[0].id);
      anchorToVideoId.set(s.anchor, candidates[0].id);
    }
  }

  // Pass 2: Two-sided unique fingerprint match (unique in remaining shots AND unique in remaining videos, compatible identity)
  for (const s of shots) {
    if (anchorToVideoId.has(s.anchor)) continue;
    const sameFpShots = shots.filter(
      (x) =>
        !anchorToVideoId.has(x.anchor) && x.fingerprint === s.fingerprint,
    );
    if (sameFpShots.length !== 1) continue;
    const candidates = existingVideos.filter(
      (v) =>
        !claimedVideoIds.has(v.id) &&
        v.extra_params?.script_fingerprint === s.fingerprint &&
        isIdentityCompatible(s, v),
    );
    if (candidates.length === 1) {
      claimedVideoIds.add(candidates[0].id);
      anchorToVideoId.set(s.anchor, candidates[0].id);
    }
  }

  // Pass 3: Two-sided unique actionSig match within same scene
  for (const s of shots) {
    if (anchorToVideoId.has(s.anchor) || !s.actionSig) continue;
    const sameActionShots = shots.filter(
      (x) =>
        !anchorToVideoId.has(x.anchor) &&
        x.sceneCode === s.sceneCode &&
        x.actionSig === s.actionSig,
    );
    if (sameActionShots.length !== 1) continue;
    const candidates = existingVideos.filter((v) => {
      if (claimedVideoIds.has(v.id)) return false;
      const vScene =
        typeof v.extra_params?.script_scene_code === "string"
          ? v.extra_params.script_scene_code
          : typeof v.extra_params?.script_anchor === "string"
            ? v.extra_params.script_anchor.split("-")[0]
            : "";
      return (
        vScene === s.sceneCode &&
        v.extra_params?.script_action_sig === s.actionSig &&
        isIdentityCompatible(s, v)
      );
    });
    if (candidates.length === 1) {
      claimedVideoIds.add(candidates[0].id);
      anchorToVideoId.set(s.anchor, candidates[0].id);
    }
  }

  const mayHaveOutputOrActiveRun = (v: CanvasNode): boolean =>
    !runsKnown || nodeHasOutputOrActiveRun(v, runs);

  // Pass 4: Positional anchor fallback ONLY for confirmed empty placeholder nodes (!mayHaveOutputOrActiveRun) with compatible identity.
  // Media-bearing or run-uncertain nodes that did not match by shotId, fingerprint, or actionSig NEVER auto-bind by position!
  for (const s of shots) {
    if (anchorToVideoId.has(s.anchor)) continue;
    const sameSceneCount =
      existingSceneCounts.get(s.sceneCode) ===
      currentSceneCounts.get(s.sceneCode);
    if (!sameSceneCount) continue;
    const posCandidate = existingVideos.find(
      (v) =>
        !claimedVideoIds.has(v.id) &&
        v.extra_params?.script_anchor === s.anchor &&
        !mayHaveOutputOrActiveRun(v) &&
        isIdentityCompatible(s, v),
    );
    if (posCandidate) {
      claimedVideoIds.add(posCandidate.id);
      anchorToVideoId.set(s.anchor, posCandidate.id);
    }
  }

  const unmatchedMediaNodes = existingVideos.filter(
    (v) => !claimedVideoIds.has(v.id) && mayHaveOutputOrActiveRun(v),
  );
  return { anchorToVideoId, unmatchedMediaNodes };
}

export function detectAmbiguousShotMatches(
  doc: Doc,
  breakdown: ScriptBreakdown,
  selectedAnchors?: string[],
  runs: Job[] = [],
  runsKnown = true,
): AmbiguousShotMatch[] {
  const fullPlan = computeShotBindingPlan(
    doc.nodes,
    breakdown.docId,
    breakdown.shots,
    {},
    runs,
    runsKnown,
  );
  const rawSelectedSet =
    selectedAnchors !== undefined ? new Set(selectedAnchors) : null;
  const isPartialSelection =
    rawSelectedSet !== null &&
    breakdown.shots.some((s) => !rawSelectedSet.has(s.anchor));
  const activeShots = isPartialSelection
    ? breakdown.shots.filter((s) => rawSelectedSet.has(s.anchor))
    : breakdown.shots;
  if (isPartialSelection && activeShots.length === 0) {
    return [];
  }
  const unboundActiveShots = activeShots.filter(
    (s) => !fullPlan.anchorToVideoId.has(s.anchor),
  );

  return fullPlan.unmatchedMediaNodes
    .filter((v) => {
      if (!isPartialSelection || !rawSelectedSet) return true;
      const prevAnchor =
        typeof v.extra_params?.script_anchor === "string"
          ? v.extra_params.script_anchor
          : "";
      const sceneCode =
        typeof v.extra_params?.script_scene_code === "string"
          ? v.extra_params.script_scene_code
          : prevAnchor.split("-")[0] || "";
      if (prevAnchor && rawSelectedSet.has(prevAnchor)) return true;
      return unboundActiveShots.some(
        (s) => !sceneCode || s.sceneCode === sceneCode,
      );
    })
    .map((v) => {
      const prevAnchor =
        typeof v.extra_params?.script_anchor === "string"
          ? v.extra_params.script_anchor
          : "";
      const sceneCode =
        typeof v.extra_params?.script_scene_code === "string"
          ? v.extra_params.script_scene_code
          : prevAnchor.split("-")[0] || "";
      const sceneCandidates = unboundActiveShots
        .filter((s) => !sceneCode || s.sceneCode === sceneCode)
        .map((s) => s.anchor);
      const fallbackCandidates = unboundActiveShots.map((s) => s.anchor);
      return {
        existingVideoNodeId: v.id,
        existingTitle: v.title,
        previousAnchor: prevAnchor,
        sceneCode,
        candidateAnchors: sceneCandidates.length
          ? sceneCandidates
          : fallbackCandidates,
      };
    });
}

export function extractScriptAnchorsMap(
  doc: Doc,
  scriptDocId?: string,
  runs: Job[] = [],
): Record<string, ScriptAnchorLink> {
  const result: Record<string, ScriptAnchorLink> = {};
  for (const node of doc.nodes) {
    if (node.type !== "video") continue;
    const extra = node.extra_params;
    if (!extra || typeof extra.script_anchor !== "string") continue;
    if (scriptDocId && extra.script_doc_id !== scriptDocId) continue;
    const anchor = extra.script_anchor;
    const shotId =
      typeof extra.script_shot_id === "string" ? extra.script_shot_id : "";
    const textNode = doc.nodes.find(
      (n) =>
        n.type === "text" &&
        ((shotId && n.extra_params?.script_shot_id === shotId) ||
          (!shotId && n.extra_params?.script_anchor === anchor)) &&
        (!scriptDocId || n.extra_params?.script_doc_id === scriptDocId),
    );
    result[anchor] = {
      anchor,
      shotId,
      videoNodeId: node.id,
      textNodeId: textNode?.id ?? null,
      title: node.title,
      hasMedia: nodeHasOutputOrActiveRun(node, runs),
      seconds: node.params.seconds,
    };
  }
  return result;
}

function escapeLiteralRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function applyMatchSpansReplacement(
  sourceText: string,
  matches: { start: number; end: number }[],
  replacement: string,
): string {
  if (!matches.length) return sourceText;
  const sorted = [...matches].sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const m of sorted) {
    if (m.start < cursor || m.end > sourceText.length) continue;
    out += sourceText.slice(cursor, m.start) + replacement;
    cursor = m.end;
  }
  out += sourceText.slice(cursor);
  return out;
}

export function searchCanvasTextNodes(
  doc: Doc,
  canvasMeta: { id: string; title: string },
  query: string,
  caseSensitive = false,
  maxMatchesPerNode = 200,
): CanvasNodeSearchMatch[] {
  if (!query) return [];
  const results: CanvasNodeSearchMatch[] = [];
  const re = new RegExp(
    escapeLiteralRegExp(query),
    caseSensitive ? "g" : "gi",
  );

  for (const node of doc.nodes) {
    const field: "text" | "prompt" =
      node.type === "text" || node.type === "sticky" ? "text" : "prompt";
    const currentText = field === "text" ? node.text : node.prompt;
    if (!currentText) continue;

    re.lastIndex = 0;
    const matches: CanvasNodeSearchMatch["matches"] = [];
    let truncated = false;
    let m: RegExpExecArray | null;
    while ((m = re.exec(currentText)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      if (matches.length >= maxMatchesPerNode) {
        truncated = true;
        break;
      }
      const idx = m.index;
      const end = idx + m[0].length;
      const beforeBlock = currentText.slice(0, idx);
      const lineIdx = beforeBlock.split("\n").length;
      const lastNewline = beforeBlock.lastIndexOf("\n");
      const column = idx - (lastNewline < 0 ? 0 : lastNewline + 1) + 1;
      const lineEnd = currentText.indexOf("\n", idx);
      const actualEnd = lineEnd < 0 ? currentText.length : lineEnd;
      const snippetStart = Math.max(lastNewline + 1, idx - 32);
      const snippetEnd = Math.min(actualEnd, end + 40);
      matches.push({
        start: idx,
        end,
        line: lineIdx,
        column,
        before: currentText.slice(snippetStart, idx),
        text: currentText.slice(idx, end),
        after: currentText.slice(end, snippetEnd),
      });
    }

    if (matches.length) {
      results.push({
        canvasId: canvasMeta.id,
        canvasTitle: canvasMeta.title,
        nodeId: node.id,
        nodeTitle: node.title,
        nodeType: node.type,
        field,
        currentText,
        truncated,
        matches,
      });
    }
  }
  return results;
}

export const MAX_CANVAS_NODE_TEXT_CHARS = 12000;

export function replaceCanvasNodeText(
  doc: Doc,
  nodeId: string,
  expectedText: string,
  nextText: string,
): Doc {
  const target = doc.nodes.find((n) => n.id === nodeId);
  if (!target) {
    throw new Error("目标画布节点已删除，请刷新后重试");
  }
  const field: "text" | "prompt" =
    target.type === "text" || target.type === "sticky" ? "text" : "prompt";
  const current = field === "text" ? target.text : target.prompt;
  if (current !== expectedText) {
    throw new Error(`节点「${target.title}」内容已变化，请重新搜索后再替换`);
  }
  if ([...nextText].length > MAX_CANVAS_NODE_TEXT_CHARS) {
    throw new Error(
      `节点「${target.title || target.id}」替换后超出 ${MAX_CANVAS_NODE_TEXT_CHARS} 字上限，已保留原文`,
    );
  }
  return {
    ...doc,
    nodes: doc.nodes.map((n) =>
      n.id === nodeId ? { ...n, [field]: nextText } : n,
    ),
  };
}

export type PersistedScriptDraftRecord = {
  draftBody: string;
  savedBody: string;
  baseRevision: number;
  conflicted?: boolean;
  updatedAt: number;
};

export function reconcileLoadedScriptDraft(
  server: { body_md: string; revision: number },
  persisted: PersistedScriptDraftRecord | null,
): {
  draftBody: string;
  savedBody: string;
  baseRevision: number;
  revision: number;
  status: "saved" | "dirty" | "conflict";
  error: string;
  storageAction: "none" | "clear" | "keep" | "persist_conflict";
  nextPersisted: PersistedScriptDraftRecord | null;
} {
  if (!persisted) {
    return {
      draftBody: server.body_md,
      savedBody: server.body_md,
      baseRevision: server.revision,
      revision: server.revision,
      status: "saved",
      error: "",
      storageAction: "none",
      nextPersisted: null,
    };
  }
  if (!persisted.conflicted && persisted.draftBody === server.body_md) {
    return {
      draftBody: server.body_md,
      savedBody: server.body_md,
      baseRevision: server.revision,
      revision: server.revision,
      status: "saved",
      error: "",
      storageAction: "clear",
      nextPersisted: null,
    };
  }
  if (!persisted.conflicted && server.revision === persisted.baseRevision) {
    return {
      draftBody: persisted.draftBody,
      savedBody: server.body_md,
      baseRevision: persisted.baseRevision,
      revision: server.revision,
      status: "dirty",
      error: "",
      storageAction: "keep",
      nextPersisted: persisted,
    };
  }
  const conflictRecord: PersistedScriptDraftRecord = {
    draftBody: persisted.draftBody,
    savedBody: persisted.savedBody,
    baseRevision: persisted.baseRevision,
    conflicted: true,
    updatedAt: persisted.updatedAt,
  };
  return {
    draftBody: persisted.draftBody,
    savedBody: persisted.savedBody,
    baseRevision: persisted.baseRevision,
    revision: server.revision,
    status: "conflict",
    error:
      "检测到未同步的本地剧本草稿与服务器新版本冲突，本地草稿已为你保留。",
    storageAction: "persist_conflict",
    nextPersisted: conflictRecord,
  };
}

export function buildPersistedScriptDraftForSession(
  session: {
    draftBody: string;
    savedBody: string;
    baseRevision: number;
    revision: number;
    status: "saved" | "dirty" | "saving" | "conflict" | "error";
  },
  now = Date.now(),
): PersistedScriptDraftRecord | null {
  if (session.status === "conflict") {
    return {
      draftBody: session.draftBody,
      savedBody: session.savedBody,
      baseRevision: session.baseRevision,
      conflicted: true,
      updatedAt: now,
    };
  }
  if (session.draftBody === session.savedBody) {
    return null;
  }
  return {
    draftBody: session.draftBody,
    savedBody: session.savedBody,
    baseRevision: session.revision,
    conflicted: false,
    updatedAt: now,
  };
}

export function resolveChatReplaceTarget(params: {
  currentProjectId: string;
  nodes: Pick<CanvasNode, "id" | "type" | "text">[];
  messageContent: string;
  options?: {
    expectedText?: string;
    targetNode?: string;
    targetProject?: string;
  };
}): { nodeId: string; expectedText: string } {
  const { currentProjectId, nodes, messageContent, options } = params;
  if (options?.targetProject && options.targetProject !== currentProjectId) {
    throw new Error("该回复来自其他画布，请使用「新建文本节点」放入当前画布。");
  }
  const targetNodeId = options?.targetNode;
  if (!targetNodeId || typeof options?.expectedText !== "string") {
    throw new Error(
      "提问时未选中文本节点，请使用「新建文本节点」或选中文本节点后重新提问。",
    );
  }
  const target = nodes.find(
    (n) => n.id === targetNodeId && (n.type === "text" || n.type === "sticky"),
  );
  if (!target) {
    throw new Error("文本节点已删除，未写入结果");
  }
  if (
    target.text !== options.expectedText &&
    target.text !== messageContent
  ) {
    throw new Error("节点文字已被修改，未覆盖。请基于当前文字重新生成。");
  }
  return {
    nodeId: target.id,
    expectedText: target.text,
  };
}

export type ExportedUnsavedScript = {
  id: string;
  path: string;
  doc_kind: string;
  status: string;
  base_revision: number;
  server_revision: number;
  saved_body_md: string;
  draft_body_md: string;
};

export function buildCanvasLocalBackup<T extends Record<string, unknown>>(
  canvasDraft: T,
  unsavedScripts: ExportedUnsavedScript[],
): T & { unsaved_scripts?: ExportedUnsavedScript[] } {
  if (!unsavedScripts.length) return { ...canvasDraft };
  return {
    ...canvasDraft,
    unsaved_scripts: unsavedScripts,
  };
}

export type ReconcilableOpenScriptSession = {
  draftBody: string;
  savedBody: string;
  baseRevision: number;
  revision: number;
  status: "saved" | "dirty" | "saving" | "conflict" | "error";
  error: string;
};

export function reconcileRenamedOpenScriptSession(
  session: ReconcilableOpenScriptSession,
  remote: { revision: number; body_md: string },
): ReconcilableOpenScriptSession {
  const hasLocalDraft =
    session.status === "conflict" || session.draftBody !== session.savedBody;
  if (!hasLocalDraft) {
    return {
      draftBody: remote.body_md,
      savedBody: remote.body_md,
      baseRevision: remote.revision,
      revision: remote.revision,
      status: "saved",
      error: "",
    };
  }
  if (remote.body_md === session.draftBody) {
    return {
      draftBody: remote.body_md,
      savedBody: remote.body_md,
      baseRevision: remote.revision,
      revision: remote.revision,
      status: "saved",
      error: "",
    };
  }
  if (session.status !== "conflict" && remote.body_md === session.savedBody) {
    return {
      draftBody: session.draftBody,
      savedBody: remote.body_md,
      baseRevision: remote.revision,
      revision: remote.revision,
      status: session.status,
      error: session.error,
    };
  }
  return {
    draftBody: session.draftBody,
    savedBody: remote.body_md,
    baseRevision: session.baseRevision,
    revision: remote.revision,
    status: "conflict",
    error:
      session.error ||
      "目录重命名期间该文档已被其他协作者修改，本地草稿已保留，请选择保留哪一版",
  };
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256HexUtf8(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const padLen = ((bytes.length + 9 + 63) & ~63);
  const buf = new Uint8Array(padLen);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(padLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667,
    h1 = 0xbb67ae85,
    h2 = 0x3c6ef372,
    h3 = 0xa54ff53a,
    h4 = 0x510e527f,
    h5 = 0x9b05688c,
    h6 = 0x1f83d9ab,
    h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let offset = 0; offset < padLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4,
      f = h5,
      g = h6,
      h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((x) => x.toString(16).padStart(8, "0"))
    .join("");
}

export function computeScriptDescendantsSignature(
  entries: ReadonlyArray<{ id: string; revision: number }>,
): string {
  const canonical = entries
    .map((e) => `${e.id}:${Number(e.revision)}`)
    .sort()
    .join(",");
  return sha256HexUtf8(canonical);
}

export type CanvasRunsSnapshot<J> = {
  runs: J[];
  runsKnown: boolean;
};

export function createCanvasRunsTracker<J>(options: {
  reconcile: (prev: J[], incoming: J[]) => J[];
  isAlive?: () => boolean;
}) {
  let generation = 0;
  let seq = 0;
  let lastSuccessSeq = 0;
  let currentRuns: J[] = [];
  // Only the latest issued request in the current generation counts as "in flight".
  // Obsolete superseded requests neither block polling nor satisfy ensureFresh!
  let latestWait: Promise<void> | null = null;
  let wakeLatestWait: (() => void) | null = null;
  const stateChangeWaiters = new Set<() => void>();

  const notifyStateChange = () => {
    if (stateChangeWaiters.size === 0) return;
    const waiters = Array.from(stateChangeWaiters);
    stateChangeWaiters.clear();
    for (const wake of waiters) {
      wake();
    }
  };

  const waitNextChange = (): Promise<void> =>
    new Promise<void>((resolve) => {
      stateChangeWaiters.add(resolve);
    });

  const checkAlive = (override?: () => boolean): boolean => {
    if (override && !override()) return false;
    if (options.isAlive && !options.isAlive()) return false;
    return true;
  };

  const reset = (initialRuns: J[] = []) => {
    generation++;
    seq = 0;
    lastSuccessSeq = 0;
    currentRuns = initialRuns;
    const wake = wakeLatestWait;
    latestWait = null;
    wakeLatestWait = null;
    wake?.();
    notifyStateChange();
  };

  const getCurrentRuns = () => currentRuns;

  const runFetch = async <Extra>(
    fetcher: () => Promise<{ runs: J[]; extra: Extra }>,
    hooks?: {
      silent?: boolean;
      isAlive?: () => boolean;
      onStart?: () => void;
      onCommit?: (nextRuns: J[], extra: Extra) => void;
      onError?: (err: unknown) => void;
      onFinally?: () => void;
    },
  ): Promise<J[]> => {
    const myGen = generation;
    const mySeq = ++seq;
    // Immediately wake any waiter that was waiting on a now-superseded request
    const prevWake = wakeLatestWait;
    let resolveMyWait!: () => void;
    const myWait = new Promise<void>((resolve) => {
      resolveMyWait = resolve;
    });
    latestWait = myWait;
    wakeLatestWait = resolveMyWait;
    prevWake?.();
    notifyStateChange();

    let fetchError: unknown;
    let fetchOk = false;
    let rawIncoming: J[] = [];

    const task = (async (): Promise<void> => {
      try {
        hooks?.onStart?.();
        const { runs: incoming, extra } = await fetcher();
        rawIncoming = incoming;
        fetchOk = true;
        const active =
          myGen === generation &&
          mySeq === seq &&
          checkAlive(hooks?.isAlive);
        if (active) {
          const nextRuns = options.reconcile(currentRuns, incoming);
          // Synchronously update readable snapshot & success watermark BEFORE resolving the Promise or scheduling React state updates
          currentRuns = nextRuns;
          lastSuccessSeq = mySeq;
          hooks?.onCommit?.(nextRuns, extra);
        }
      } catch (err) {
        fetchError = err;
        const active =
          myGen === generation &&
          mySeq === seq &&
          checkAlive(hooks?.isAlive);
        if (active) {
          hooks?.onError?.(err);
        }
      } finally {
        if (myGen === generation && mySeq === seq) {
          latestWait = null;
          wakeLatestWait = null;
          hooks?.onFinally?.();
        }
        resolveMyWait();
        notifyStateChange();
      }
    })();

    await task;

    if (!fetchOk) {
      if (hooks?.silent) return [];
      throw fetchError;
    }
    if (myGen === generation && lastSuccessSeq >= mySeq) {
      return currentRuns;
    }
    return rawIncoming;
  };

  const ensureFresh = async (
    freshFetch: () => Promise<J[]>,
  ): Promise<CanvasRunsSnapshot<J>> => {
    const startGen = generation;
    const entrySeq = seq;
    const latestWasInFlightAtEntry = latestWait !== null;

    while (generation === startGen && checkAlive() && latestWait !== null) {
      await latestWait;
    }
    if (generation !== startGen || !checkAlive()) {
      return { runs: currentRuns, runsKnown: false };
    }
    if (
      latestWasInFlightAtEntry &&
      entrySeq > 0 &&
      lastSuccessSeq === seq &&
      seq >= entrySeq
    ) {
      return { runs: currentRuns, runsKnown: true };
    }

    const beforeFreshSeq = seq;
    let standaloneDone = false;
    let standaloneOk = false;
    let standaloneRuns: J[] = [];

    let rawPromise: Promise<J[]> | null = null;
    try {
      rawPromise = freshFetch();
    } catch {
      standaloneDone = true;
      standaloneOk = false;
    }

    // Attach rejection handling immediately so superseded/reset in-flight requests never cause unhandled rejections,
    // while waiting on wakeable latestWait instead of awaiting rawPromise directly.
    if (rawPromise !== null) {
      void rawPromise.then(
        (res) => {
          standaloneDone = true;
          standaloneOk = true;
          standaloneRuns = res;
          notifyStateChange();
        },
        () => {
          standaloneDone = true;
          standaloneOk = false;
          notifyStateChange();
        },
      );
    }

    while (generation === startGen && checkAlive()) {
      if (seq > beforeFreshSeq) {
        if (latestWait === null) break;
        await latestWait;
        continue;
      }
      if (standaloneDone) break;
      await waitNextChange();
    }

    if (generation !== startGen || !checkAlive()) {
      return { runs: currentRuns, runsKnown: false };
    }
    if (seq > beforeFreshSeq) {
      return { runs: currentRuns, runsKnown: lastSuccessSeq === seq };
    }
    if (standaloneOk) {
      const nextSeq = ++seq;
      const nextRuns = options.reconcile(currentRuns, standaloneRuns);
      currentRuns = nextRuns;
      lastSuccessSeq = nextSeq;
      return { runs: currentRuns, runsKnown: true };
    }
    return { runs: currentRuns, runsKnown: false };
  };

  return {
    reset,
    getCurrentRuns,
    hasInFlight: () => latestWait !== null,
    runFetch,
    ensureFresh,
  };
}
