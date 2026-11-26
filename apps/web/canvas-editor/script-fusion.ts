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
    actions: string[];
    dialogues: { speaker: string; text: string }[];
    lineStart: number;
    lineEnd: number;
    explicitSeconds?: number;
  };
  let currentBeat: PendingBeat | null = null;
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
    const actionText = currentBeat.actions.join(" ").trim();
    const dialogues = currentBeat.dialogues;

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
      const segments = raw
        .split(/(?=[△▲])/)
        .map((s) => s.replace(/^[△▲]\s*/, "").trim())
        .filter(Boolean);
      if (currentBeat && (currentBeat.dialogues.length > 0 || currentBeat.actions.length > 0)) {
        flushBeat();
      }
      if (!currentBeat) {
        currentBeat = {
          actions: [],
          dialogues: [],
          lineStart: lineNo,
          lineEnd: lineNo,
        };
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

  const ensureEdge = (source: string, target: string) => {
    if (source === target) return;
    if (nextEdges.some((e) => e.source === source && e.target === target)) return;
    if (nextEdges.length >= 1200) return;
    const sourceNode = nextNodes.find((n) => n.id === source);
    if (sourceNode?.type === "image") {
      const existingImageRefs = nextEdges.filter((e) => {
        if (e.target !== target) return false;
        const s = nextNodes.find((n) => n.id === e.source);
        return s?.type === "image";
      }).length;
      if (existingImageRefs >= 9) return;
    }
    nextEdges.push({
      id: `edge_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
      source,
      target,
    });
  };

  // 2. Sync Shot Chains (Text Prompt Node + Optional Grid Image + Video Shot Node)
  activeShots.forEach((shot, index) => {
    const dialogueLines: DialogueLine[] = shot.dialogues.map((d, dIdx) => ({
      id: `dlg_${sanitizeIdPart(shot.anchor)}_${dIdx + 1}`,
      speaker: d.speaker.slice(0, 40),
      text: d.text.slice(0, 300),
    }));

    const existingVideo = nextNodes.find(
      (n) =>
        n.type === "video" &&
        n.extra_params?.script_doc_id === breakdown.docId &&
        n.extra_params?.script_anchor === shot.anchor,
    );
    const existingText = nextNodes.find(
      (n) =>
        n.type === "text" &&
        n.extra_params?.script_doc_id === breakdown.docId &&
        n.extra_params?.script_anchor === shot.anchor,
    );

    if (existingVideo) {
      if (existingText && existingText.text !== shot.prompt) {
        existingText.text = shot.prompt;
        existingText.title = `${shot.title} · 剧本提示词`.slice(0, 80);
        existingText.extra_params = {
          ...(existingText.extra_params ?? {}),
          script_doc_id: breakdown.docId,
          script_doc_path: breakdown.docPath,
          script_anchor: shot.anchor,
          script_line: shot.lineStart,
        };
        updatedNodeIds.push(existingText.id);
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

      const changed =
        existingVideo.title !== shot.title ||
        existingVideo.narration_text !== shot.narration ||
        JSON.stringify(existingVideo.dialogue_lines ?? []) !==
          JSON.stringify(mergedDlg);

      existingVideo.title = shot.title;
      existingVideo.narration_text = shot.narration;
      existingVideo.dialogue_lines = mergedDlg;
      existingVideo.cinematography = {
        ...shot.cinematography,
        ...(existingVideo.cinematography ?? {}),
      };
      existingVideo.extra_params = {
        ...(existingVideo.extra_params ?? {}),
        script_doc_id: breakdown.docId,
        script_doc_path: breakdown.docPath,
        script_anchor: shot.anchor,
        script_line: shot.lineStart,
      };
      if (changed) updatedNodeIds.push(existingVideo.id);

      if (existingText) ensureEdge(existingText.id, existingVideo.id);
      for (const assetKey of shot.referencedAssets) {
        const assetNodeId = assetKeyToNodeId.get(assetKey);
        if (assetNodeId) ensureEdge(assetNodeId, existingVideo.id);
      }
      if (!nextShots.includes(existingVideo.id)) {
        nextShots.push(existingVideo.id);
      }
      shotNodeIds.push(existingVideo.id);
      anchorToNodeId[shot.anchor] = existingVideo.id;
      return;
    }

    const neededNodes = isGridPreview ? 3 : 2;
    if (nextNodes.length + neededNodes > 400) return;

    const colX = shotStartX + index * 420;
    const textNode = newNode("text", colX, 60, nextNodes.length + 1);
    textNode.id = `scr_${sanitizeIdPart(shot.anchor)}_${crypto.randomUUID().slice(0, 6)}`;
    textNode.title = `${shot.title} · 剧本提示词`.slice(0, 80);
    textNode.text = shot.prompt;
    textNode.color = "purple";
    textNode.extra_params = {
      script_doc_id: breakdown.docId,
      script_doc_path: breakdown.docPath,
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
    videoNode.extra_params = {
      script_doc_id: breakdown.docId,
      script_doc_path: breakdown.docPath,
      script_anchor: shot.anchor,
      script_line: shot.lineStart,
    };
    nextNodes.push(videoNode);
    createdNodeIds.push(videoNode.id);

    if (gridNode) {
      ensureEdge(textNode.id, gridNode.id);
      ensureEdge(gridNode.id, videoNode.id);
    } else {
      ensureEdge(textNode.id, videoNode.id);
    }

    for (const assetKey of shot.referencedAssets) {
      const assetNodeId = assetKeyToNodeId.get(assetKey);
      if (assetNodeId) {
        ensureEdge(assetNodeId, gridNode ? gridNode.id : videoNode.id);
      }
    }

    if (nextShots.length < 200) {
      nextShots.push(videoNode.id);
    }
    shotNodeIds.push(videoNode.id);
    anchorToNodeId[shot.anchor] = videoNode.id;
  });

  return {
    document: {
      ...doc,
      nodes: nextNodes,
      edges: nextEdges,
      shots: nextShots,
    },
    createdNodeIds,
    updatedNodeIds,
    shotNodeIds,
    anchorToNodeId,
  };
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
    const textNode = doc.nodes.find(
      (n) =>
        n.type === "text" &&
        n.extra_params?.script_anchor === anchor &&
        (!scriptDocId || n.extra_params?.script_doc_id === scriptDocId),
    );
    result[anchor] = {
      anchor,
      videoNodeId: node.id,
      textNodeId: textNode?.id ?? null,
      title: node.title,
      hasMedia: Boolean(node.media_id || node.active_job),
      seconds: node.params.seconds,
    };
  }
  return result;
}

export function searchCanvasTextNodes(
  doc: Doc,
  canvasMeta: { id: string; title: string },
  query: string,
  caseSensitive = false,
): CanvasNodeSearchMatch[] {
  const needle = caseSensitive ? query : query.toLowerCase();
  if (!needle) return [];
  const results: CanvasNodeSearchMatch[] = [];

  for (const node of doc.nodes) {
    const field: "text" | "prompt" =
      node.type === "text" || node.type === "sticky" ? "text" : "prompt";
    const currentText = field === "text" ? node.text : node.prompt;
    if (!currentText) continue;
    const haystack = caseSensitive ? currentText : currentText.toLowerCase();
    if (!haystack.includes(needle)) continue;

    const matches: CanvasNodeSearchMatch["matches"] = [];
    let cursor = 0;
    while (cursor <= haystack.length - needle.length && matches.length < 50) {
      const idx = haystack.indexOf(needle, cursor);
      if (idx < 0) break;
      const end = idx + needle.length;
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
      cursor = Math.max(end, idx + 1);
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
