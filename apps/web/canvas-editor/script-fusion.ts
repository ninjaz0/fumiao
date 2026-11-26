import {
  defaults,
  newNode,
  type CanvasEdge,
  type CanvasGenerationMode,
  type CanvasNode,
  type CinematographySpec,
  type DialogueLine,
  type Doc,
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
};

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

export function stampScriptShotIds(markdown: string): {
  markdown: string;
  changed: boolean;
} {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let changed = false;
  let pendingIdForNextBeat = false;
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (SHOT_COMMENT_SINGLE_RE.test(trimmed) && !/^[△▲]/.test(trimmed)) {
      pendingIdForNextBeat = true;
      out.push(lines[i]);
      continue;
    }
    if (/^[△▲]/.test(trimmed)) {
      if (!SHOT_COMMENT_SINGLE_RE.test(trimmed) && !pendingIdForNextBeat) {
        const shotUid = `sh_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
        out.push(`${lines[i]} <!-- fm-shot:${shotUid} -->`);
        changed = true;
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
  if (includeAssets) {
    breakdown.assets.forEach((asset, idx) => {
      const expectedTitle = `资产 · ${asset.code} ${asset.name}`.slice(0, 80);
      let existing = nextNodes.find(
        (n) =>
          n.type === "image" &&
          (n.extra_params?.script_asset_key === asset.key ||
            n.title.trim() === expectedTitle ||
            n.title.includes(asset.name)),
      );

      if (existing) {
        assetKeyToNodeId.set(asset.key, existing.id);
        const nextPrompt = existing.prompt.trim() ? existing.prompt : asset.prompt;
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

  const ensureEdge = (source: string, target: string): string | null => {
    if (source === target) return null;
    const existing = nextEdges.find(
      (e) => e.source === source && e.target === target,
    );
    if (existing) return `${source}>${target}`;
    if (nextEdges.length >= 1200) return null;
    const sourceNode = nextNodes.find((n) => n.id === source);
    if (sourceNode?.type === "image") {
      const existingImageRefs = nextEdges.filter((e) => {
        if (e.target !== target) return false;
        const s = nextNodes.find((n) => n.id === e.source);
        return s?.type === "image";
      }).length;
      if (existingImageRefs >= 9) return null;
    }
    nextEdges.push({
      id: `edge_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
      source,
      target,
    });
    return `${source}>${target}`;
  };

  const bindingPlan = computeShotBindingPlan(
    nextNodes,
    breakdown.docId,
    activeShots,
    options.explicitNodeBindings ?? {},
  );

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
      const effectiveShotId =
        shot.shotId ||
        prevShotId ||
        `sh_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;

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
        !existingGrid.media_id &&
        !existingGrid.active_job
      ) {
        // Switching away from grid_preview when grid node has no generated media: clean up unused grid node
        const gridIdToRemove = existingGrid.id;
        const gIdx = nextNodes.findIndex((n) => n.id === gridIdToRemove);
        if (gIdx >= 0) nextNodes.splice(gIdx, 1);
        for (let eIdx = nextEdges.length - 1; eIdx >= 0; eIdx--) {
          if (
            nextEdges[eIdx].source === gridIdToRemove ||
            nextEdges[eIdx].target === gridIdToRemove
          ) {
            nextEdges.splice(eIdx, 1);
          }
        }
        existingGrid = undefined;
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

      // Reconcile script-managed edges: remove obsolete script-managed pairs, keep manual edges!
      const prevManagedRaw =
        typeof existingVideo.extra_params?.script_managed_edges === "string"
          ? existingVideo.extra_params.script_managed_edges
          : "";
      const prevManagedSet = new Set(
        prevManagedRaw.split("|").map((s) => s.trim()).filter(Boolean),
      );
      const desiredManagedPairs = new Set<string>();
      if (isGridPreview && existingGrid) {
        if (existingText) desiredManagedPairs.add(`${existingText.id}>${existingGrid.id}`);
        desiredManagedPairs.add(`${existingGrid.id}>${existingVideo.id}`);
        for (const assetKey of shot.referencedAssets) {
          const assetNodeId = assetKeyToNodeId.get(assetKey);
          if (assetNodeId) desiredManagedPairs.add(`${assetNodeId}>${existingGrid.id}`);
        }
      } else {
        if (existingText) desiredManagedPairs.add(`${existingText.id}>${existingVideo.id}`);
        for (const assetKey of shot.referencedAssets) {
          const assetNodeId = assetKeyToNodeId.get(assetKey);
          if (assetNodeId) desiredManagedPairs.add(`${assetNodeId}>${existingVideo.id}`);
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
        const added = ensureEdge(src, tgt);
        if (added) activeManagedPairs.push(added);
      }

      const changed =
        existingVideo.title !== shot.title ||
        existingVideo.narration_text !== shot.narration ||
        existingVideo.extra_params?.script_anchor !== shot.anchor ||
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

    const effectiveShotId =
      shot.shotId ||
      `sh_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
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
      const p1 = ensureEdge(textNode.id, gridNode.id);
      const p2 = ensureEdge(gridNode.id, videoNode.id);
      if (p1) managedPairs.push(p1);
      if (p2) managedPairs.push(p2);
    } else {
      const p1 = ensureEdge(textNode.id, videoNode.id);
      if (p1) managedPairs.push(p1);
    }

    for (const assetKey of shot.referencedAssets) {
      const assetNodeId = assetKeyToNodeId.get(assetKey);
      if (assetNodeId) {
        const pRef = ensureEdge(
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

  // Maintain shot list in script order for synced shots while preserving other manual shots
  const syncedSet = new Set(shotNodeIds);
  const nonSyncedShots = nextShots.filter((id) => !syncedSet.has(id));
  const orderedShots = [...nonSyncedShots, ...shotNodeIds].slice(0, 200);

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
): {
  anchorToVideoId: Map<string, string>;
  unmatchedMediaNodes: CanvasNode[];
} {
  const existingVideos = nodes.filter(
    (n) => n.type === "video" && n.extra_params?.script_doc_id === docId,
  );
  const claimedVideoIds = new Set<string>();
  const anchorToVideoId = new Map<string, string>();

  // Count existing vs current shots per scene so positional fallback is NEVER used when shots were inserted/deleted on media nodes!
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

  // Pass 1: Explicit user confirmation bindings & persistent shotId
  for (const s of shots) {
    const explicitId = explicitBindings[s.anchor];
    if (explicitId && !claimedVideoIds.has(explicitId)) {
      const found = existingVideos.find((v) => v.id === explicitId);
      if (found) {
        claimedVideoIds.add(found.id);
        anchorToVideoId.set(s.anchor, found.id);
        continue;
      }
    }
    if (s.shotId) {
      const byShotId = existingVideos.find(
        (v) =>
          !claimedVideoIds.has(v.id) &&
          v.extra_params?.script_shot_id === s.shotId,
      );
      if (byShotId) {
        claimedVideoIds.add(byShotId.id);
        anchorToVideoId.set(s.anchor, byShotId.id);
      }
    }
  }

  // Pass 2: Unique fingerprint match (exact scene + action + dialogue signature)
  for (const s of shots) {
    if (anchorToVideoId.has(s.anchor)) continue;
    const candidates = existingVideos.filter(
      (v) =>
        !claimedVideoIds.has(v.id) &&
        v.extra_params?.script_fingerprint === s.fingerprint,
    );
    if (candidates.length === 1) {
      claimedVideoIds.add(candidates[0].id);
      anchorToVideoId.set(s.anchor, candidates[0].id);
    }
  }

  // Pass 3: Unique actionSig match within same scene (handles dialogue tweaks even when a shot was inserted!)
  for (const s of shots) {
    if (anchorToVideoId.has(s.anchor) || !s.actionSig) continue;
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
        v.extra_params?.script_action_sig === s.actionSig
      );
    });
    if (candidates.length === 1) {
      claimedVideoIds.add(candidates[0].id);
      anchorToVideoId.set(s.anchor, candidates[0].id);
    }
  }

  // Pass 4: Safe positional anchor fallback ONLY when scene shot count is unchanged OR old node has no generated media
  for (const s of shots) {
    if (anchorToVideoId.has(s.anchor)) continue;
    const posCandidate = existingVideos.find(
      (v) =>
        !claimedVideoIds.has(v.id) &&
        v.extra_params?.script_anchor === s.anchor,
    );
    if (!posCandidate) continue;
    const hasMedia = Boolean(posCandidate.media_id || posCandidate.active_job);
    const sameSceneCount =
      existingSceneCounts.get(s.sceneCode) ===
      currentSceneCounts.get(s.sceneCode);
    if (!hasMedia || sameSceneCount) {
      claimedVideoIds.add(posCandidate.id);
      anchorToVideoId.set(s.anchor, posCandidate.id);
    }
  }

  const unmatchedMediaNodes = existingVideos.filter(
    (v) => !claimedVideoIds.has(v.id) && Boolean(v.media_id || v.active_job),
  );
  return { anchorToVideoId, unmatchedMediaNodes };
}

export function detectAmbiguousShotMatches(
  doc: Doc,
  breakdown: ScriptBreakdown,
  selectedAnchors?: string[],
): AmbiguousShotMatch[] {
  const activeShots = selectedAnchors?.length
    ? breakdown.shots.filter((s) => selectedAnchors.includes(s.anchor))
    : breakdown.shots;
  const plan = computeShotBindingPlan(doc.nodes, breakdown.docId, activeShots);
  return plan.unmatchedMediaNodes.map((v) => {
    const prevAnchor =
      typeof v.extra_params?.script_anchor === "string"
        ? v.extra_params.script_anchor
        : "";
    const sceneCode =
      typeof v.extra_params?.script_scene_code === "string"
        ? v.extra_params.script_scene_code
        : prevAnchor.split("-")[0] || "";
    const sceneCandidates = activeShots
      .filter(
        (s) =>
          (!sceneCode || s.sceneCode === sceneCode) &&
          !plan.anchorToVideoId.has(s.anchor),
      )
      .map((s) => s.anchor);
    const fallbackCandidates = activeShots
      .filter((s) => !plan.anchorToVideoId.has(s.anchor))
      .map((s) => s.anchor);
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
      hasMedia: Boolean(node.media_id || node.active_job),
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
  return {
    ...doc,
    nodes: doc.nodes.map((n) =>
      n.id === nodeId ? { ...n, [field]: nextText.slice(0, 12000) } : n,
    ),
  };
}
