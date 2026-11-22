import { z } from "zod";

const key = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const text = z.string().trim().min(1).max(80);
export const importerSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
    title: text,
    target: z.enum(["assets", "canvas"]),
    audience: z.enum(["member", "admin"]).default("admin"),
    inputLabel: text,
    placeholder: z.string().max(500).optional(),
    program: z.string().min(1).max(65536),
  })
  .strict();
export const importRequestSchema = z
  .object({
    version: z.string().min(1).max(32),
    requestId: z.string().uuid(),
    source: z.string().trim().min(1).max(65536),
  })
  .strict();
export type Importer = z.infer<typeof importerSchema>;
export type ImporterEntry = Omit<Importer, "program"> & {
  plugin: string;
  version: string;
};
const asset = z
  .object({
    key,
    kind: z.enum(["image", "video", "audio"]),
    name: z.string().trim().max(120).optional(),
    url: z.string().max(2048).url(),
  })
  .strict();
const assetList = z
  .array(asset)
  .max(8)
  .refine(
    (items) => new Set(items.map((item) => item.key)).size === items.length,
    "素材标识重复",
  );
const node = z
  .object({
    id: key,
    type: z.enum(["text", "sticky", "image", "video"]),
    x: z.number().min(-100000).max(100000),
    y: z.number().min(-100000).max(100000),
    title: z.string().max(80).optional(),
    text: z.string().max(12000).optional(),
    prompt: z.string().max(12000).optional(),
    narration_text: z.string().max(300).optional(),
    narration_instruction: z.string().max(300).optional(),
    width: z.number().min(160).max(1600).optional(),
    height: z.number().min(100).max(1600).optional(),
    color: z
      .enum(["none", "mint", "blue", "purple", "orange", "yellow"])
      .optional(),
    image: key.optional(),
    references: z.array(key).max(12).optional(),
  })
  .strict();
const canvas = z
  .object({
    title: text,
    nodes: z.array(node).max(200),
    edges: z
      .array(z.object({ id: key, source: key, target: key }).strict())
      .max(600)
      .default([]),
    shots: z.array(key).max(200).optional(),
  })
  .strict();
export const importPlanSchema = z
  .discriminatedUnion("target", [
    z
      .object({
        target: z.literal("assets"),
        assets: assetList.refine(
          (items) => items.length > 0,
          "没有可导入的素材",
        ),
      })
      .strict(),
    z
      .object({
        target: z.literal("canvas"),
        assets: assetList.default([]),
        canvas,
      })
      .strict(),
  ])
  .superRefine((plan, ctx) => {
    if (plan.target !== "canvas") return;
    const assets = new Map(plan.assets.map((a) => [a.key, a.kind]));
    const nodes = new Map(plan.canvas.nodes.map((n) => [n.id, n.type]));
    if (nodes.size !== plan.canvas.nodes.length)
      ctx.addIssue({ code: "custom", message: "节点标识重复" });
    for (const n of plan.canvas.nodes) {
      if (n.image && (n.type !== "image" || assets.get(n.image) !== "image"))
        ctx.addIssue({ code: "custom", message: "图片节点引用无效" });
      if (n.references?.some((k) => !assets.has(k)))
        ctx.addIssue({ code: "custom", message: "参考素材须来自本次导入" });
    }
    if (
      plan.canvas.edges.some(
        (e) => !nodes.has(e.source) || !nodes.has(e.target),
      )
    )
      ctx.addIssue({ code: "custom", message: "连线节点不存在" });
    if (plan.canvas.shots?.some((id) => nodes.get(id) !== "video"))
      ctx.addIssue({ code: "custom", message: "分镜必须引用视频节点" });
  });
export type ImportPlan = z.infer<typeof importPlanSchema>;
export type ImportAsset = z.infer<typeof asset>;
export function parseImportPlan(
  target: Importer["target"],
  raw: unknown,
  origins: readonly string[],
) {
  const plan = importPlanSchema.parse(raw);
  if (plan.target !== target) throw Error("导入结果与声明类型不一致");
  for (const asset of plan.assets) {
    const url = new URL(asset.url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !origins.includes(url.origin)
    )
      throw Error("素材地址不在插件声明的范围内");
  }
  return plan;
}
export type ImportResult = {
  assets: { key: string; id: string; kind: ImportAsset["kind"] }[];
  canvas?: { id: string; title: string };
};
