import { z } from "zod";
import type { Sql } from "./db.js";
import { requireValue, hash } from "./security.js";
import {
  timingFeaturesSchema,
  timingPolicySchema,
} from "../../plugin-sdk/src/timing.js";

const finite = z.number().finite(),
  nonnegative = finite.nonnegative();
const prediction = z
  .object({
    source: z.string().max(80).optional(),
    samples: nonnegative.int().optional(),
    confidence: z.string().max(80).optional(),
    version: nonnegative.int().optional(),
    low: nonnegative.nullable().optional(),
    median: nonnegative.nullable().optional(),
    high: nonnegative.nullable().optional(),
    tail: nonnegative.nullable().optional(),
    calibrated: z.boolean().optional(),
    provisional: z.boolean().optional(),
  })
  .strict();
const detail = z
  .object({
    source: z.enum(["observed", "worker", "provider"]).optional(),
    admitted_at: finite.optional(),
    provider_elapsed: nonnegative.optional(),
    prepare_s: nonnegative.max(172800).optional(),
    generate_s: nonnegative.max(172800).optional(),
    finalize_s: nonnegative.max(172800).optional(),
    peak_vram_bytes: nonnegative
      .int()
      .max(2 ** 50)
      .optional(),
    peak_allocated_vram_bytes: nonnegative
      .int()
      .max(2 ** 50)
      .optional(),
    eta_history: z
      .array(
        z
          .object({
            at: finite,
            low: nonnegative,
            median: nonnegative,
            high: nonnegative,
            source: z.string().max(80),
          })
          .strict(),
      )
      .max(32)
      .optional(),
  })
  .strict();
const json = (schema: z.ZodType) =>
  z.preprocess(
    (value) => (typeof value === "string" ? JSON.parse(value) : value),
    schema,
  );
const importedRun = z.object({
  id: nonnegative.int().min(1),
  job: nonnegative.int().min(1).nullable(),
  node: z.union([z.string().max(200), nonnegative.int()]).nullable(),
  attempt: nonnegative.int(),
  kind: z.enum(["image", "video", "audio", "chat"]),
  model: z.string().max(200),
  features: json(timingFeaturesSchema),
  created: finite,
  queued: finite.nullable(),
  started: finite.nullable(),
  generating: finite.nullable(),
  finalizing: finite.nullable(),
  uploading: finite.nullable(),
  validating: finite.nullable(),
  finished: finite.nullable(),
  status: z.enum(["done", "failed", "cancelled", "interrupted", "legacy"]),
  phase: z.string().max(30),
  step: nonnegative.int().max(100),
  steps: nonnegative.int().max(100),
  progress: json(
    z.array(z.tuple([nonnegative.int().max(100), finite])).max(16),
  ),
  predicted: json(prediction),
  details: json(detail),
  valid: z.union([z.boolean(), z.literal(0), z.literal(1)]).transform(Boolean),
});

/** Numeric legacy IDs are mapped once. No live worker token or provider config
 * enters the timing table; orphan samples remain anonymous after job deletion. */
export async function importTiming(
  sql: Sql,
  source: string,
  records: Record<string, any>[],
  jobIds: Set<number>,
  id: (kind: string, value: unknown) => string,
) {
  if (!records.length) return;
  // Imported Pure records use the first compatible timing contract. Installing
  // a later queue capability must not silently relabel historical measurements.
  const plugins = (
    await sql.query(`SELECT v.id,v.version,v.manifest FROM plugin_versions v
   WHERE v.manifest->'timing' IS NOT NULL ORDER BY string_to_array(v.version,'.')::int[] ASC`)
  ).rows;
  const catalog = (await sql.query("SELECT id,plugin_id FROM studio_catalog"))
    .rows;
  const owners = new Map(catalog.map((c) => [c.id, c.plugin_id]));
  const seen = new Set<number>();
  for (const original of [...records].sort((a, b) => a.id - b.id)) {
    const r = importedRun.parse(original),
      f = timingFeaturesSchema.parse(r.features);
    requireValue(!seen.has(r.id), 400, "旧计时编号重复");
    seen.add(r.id);
    requireValue(
      r.kind === f.kind && r.model === f.model,
      400,
      "旧计时模型不一致",
    );
    const plugin = plugins.find(
      (p) =>
        p.id === owners.get(r.model) &&
        p.manifest.models.some(
          (m: any) => m.id === r.model && m.kind === r.kind,
        ),
    );
    const policy = plugin
      ? timingPolicySchema.parse(plugin.manifest.timing)
      : null;
    await sql.query(
      `INSERT INTO job_runs(job,run_key,attempt,node,plugin_id,plugin_version,policy,kind,model,features,
    created,queued,started,generating,finalizing,uploading,validating,finished,status,phase,step,steps,progress,predicted,details,valid)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
      [
        r.job !== null && jobIds.has(r.job) ? id("job", r.job) : null,
        "legacy:" + hash(source + ":" + r.id),
        r.attempt,
        r.node === null ? null : id("node", r.node),
        plugin?.id || "legacy-archive",
        plugin?.version || "1.0.0",
        policy ? JSON.stringify(policy) : null,
        r.kind,
        r.model,
        JSON.stringify(f),
        r.created,
        r.queued,
        r.started,
        r.generating,
        r.finalizing,
        r.uploading,
        r.validating,
        r.finished,
        r.status,
        r.phase,
        r.step,
        r.steps,
        JSON.stringify(r.progress),
        JSON.stringify(r.predicted),
        JSON.stringify(r.details),
        r.valid,
      ],
    );
  }
}
