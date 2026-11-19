import type {
  TimingFeatures,
  TimingPolicy,
} from "../../plugin-sdk/src/timing.js";
export const estimatorVersion = 4;
export const phases = [
  "preparing",
  "generating",
  "finalizing",
  "uploading",
  "validating",
] as const;
export type Estimate = { source: string; [key: string]: any };
export type Run = {
  policy?: TimingPolicy;
  id: string | number;
  job?: string | null;
  run_key: string;
  attempt: number;
  node: string | null;
  features: TimingFeatures;
  created: number;
  queued: number | null;
  started: number | null;
  generating: number | null;
  finalizing: number | null;
  uploading: number | null;
  validating: number | null;
  finished: number | null;
  status: string;
  phase: string;
  step: number;
  steps: number;
  progress: number[][];
  predicted: Estimate;
  details: Record<string, any>;
  valid: boolean;
};
// Python's tie-to-even rounding is observable in the original duration fields.
export function round(value: number) {
  const floor = Math.floor(value),
    fraction = value - floor;
  return fraction === 0.5 ? floor + (Math.abs(floor) % 2) : Math.round(value);
}
export function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b),
    n = sorted.length;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}
export function compensatedSum(values: number[]) {
  // Preserve Python 3.12 sum's compensated threshold; a one-ULP error at
  // exactly half the weight can select a different measured duration.
  // https://github.com/python/cpython/blob/3.12/Python/bltinmodule.c
  let total = 0,
    correction = 0;
  for (const weight of values) {
    const next = total + weight;
    correction +=
      Math.abs(total) >= Math.abs(weight)
        ? total - next + weight
        : weight - next + total;
    total = next;
  }
  return total + correction;
}
function quantile(rows: [number, number][], q: number) {
  const sorted = [...rows].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cutoff = compensatedSum(sorted.map(([, weight]) => weight)) * q;
  let sum = 0;
  for (const [value, weight] of sorted) {
    sum += weight;
    if (sum >= cutoff) return value;
  }
  return sorted.at(-1)![0];
}
export const noEstimate = (): Estimate => ({
  source: "none",
  samples: 0,
  confidence: "none",
  version: estimatorVersion,
});
export class Estimator {
  readonly samples: Run[];
  constructor(
    samples: Run[],
    readonly policy: TimingPolicy,
  ) {
    this.samples = samples
      .filter(
        (r) =>
          r.status === "legacy" ||
          (r.status === "done" && r.valid && r.started !== null),
      )
      .sort((a, b) => Number(b.id) - Number(a.id))
      .slice(0, 500);
  }
  estimate(target: TimingFeatures, nodeId: string | null = null): Estimate {
    type Match = {
      distance: number;
      actual: number;
      row: Run;
      scaled: boolean;
    };
    let matches: Match[] = [],
      cold: Match[] = [];
    const family = (workflow: string) =>
      this.policy.workflowAliases?.[workflow] || workflow;
    for (const row of this.samples) {
      const f = row.features;
      if (
        (["kind", "executor", "model", "quality", "video_mode"] as const).some(
          (k) => f[k] !== target[k],
        ) ||
        family(f.workflow) !== family(target.workflow)
      )
        continue;
      if (
        target.kind === "audio" &&
        Math.abs(Math.log(Math.max(1, f.width) / Math.max(1, target.width))) >
          Math.log(1.8)
      )
        continue;
      if (target.kind === "video" && f.seconds !== target.seconds) continue;
      if (Boolean(f.refs) !== Boolean(target.refs)) continue;
      if (this.policy.hardware) {
        if (
          target.hardware
            ? f.hardware !== target.hardware
            : !nodeId || row.node !== nodeId || !!f.hardware
        )
          continue;
      }
      const coldReference = f.cold === true && target.cold === false;
      if (
        f.cold != null &&
        target.cold != null &&
        f.cold !== target.cold &&
        !coldReference
      )
        continue;
      let distance = 0;
      if (this.policy.geometry === "native") {
        if (f.native_ratio !== target.native_ratio) continue;
      } else
        distance =
          Math.abs(
            Math.log((f.width * f.height) / (target.width * target.height)),
          ) +
          0.25 *
            Math.abs(
              Math.log(f.width / f.height / (target.width / target.height)),
            );
      distance += 0.15 * Math.abs(f.refs - target.refs);
      if (f.ref_pixels && target.ref_pixels)
        distance += 0.1 * Math.abs(Math.log(f.ref_pixels / target.ref_pixels));
      if (!Number.isFinite(distance) || distance > 1.5) continue;
      let actual = row.finished! - (row.started ?? row.created),
        scaled = false;
      if (actual <= 0) continue;
      if (
        target.kind === "video" &&
        this.policy.scaleSteps &&
        f.steps !== target.steps
      ) {
        const generated = row.details.generate_s;
        if (
          typeof generated !== "number" ||
          !(generated > 0 && generated <= actual && f.steps > 0)
        )
          continue;
        actual = actual - generated + (generated * target.steps) / f.steps;
        distance += 0.35 * Math.abs(Math.log(target.steps / f.steps));
        scaled = true;
      }
      (coldReference ? cold : matches).push({ distance, actual, row, scaled });
    }
    const coldFallback = !matches.length && !!cold.length;
    if (coldFallback) matches = cold;
    const precise = matches.filter((m) => m.row.status === "done");
    if (precise.length) matches = precise;
    if (!matches.length) return noEstimate();
    const exact = matches.filter((m) => !m.scaled);
    if (exact.length) matches = exact;
    const local = matches.filter(
      (m) =>
        nodeId &&
        m.row.node === nodeId &&
        m.row.status === "done" &&
        m.row.features.runtime_id === target.runtime_id,
    );
    const calibrated = local.length >= 3;
    if (calibrated) matches = local;
    matches.sort(
      (a, b) => a.distance - b.distance || Number(b.row.id) - Number(a.row.id),
    );
    const nearest = matches[0].distance,
      chosen = matches.filter((m) => m.distance <= nearest + 0.45).slice(0, 30);
    const weighted: [number, number][] = chosen.map((m) => [
        m.actual,
        Math.exp(-m.distance),
      ]),
      point = quantile(weighted, 0.5),
      count = chosen.length;
    const legacy = chosen[0].row.status === "legacy",
      unknown =
        this.policy.hardware &&
        chosen.some(
          (m) => !m.row.features.hardware || m.row.features.cold == null,
        ),
      scaled = chosen.some((m) => m.scaled);
    const confidence =
      count < 5 || nearest > 0.05 || legacy || unknown || coldFallback || scaled
        ? "low"
        : count < 15
          ? "medium"
          : "high";
    const spread =
      confidence === "low" ? 0.6 : confidence === "medium" ? 0.3 : 0.2;
    const low = Math.max(
        1,
        Math.min(quantile(weighted, 0.15), point * (1 - spread)),
      ),
      high = Math.max(quantile(weighted, 0.85), point * (1 + spread));
    const tails: number[] = [];
    for (const { row } of chosen) {
      if (row.finalizing && row.finished)
        tails.push(row.finished - row.finalizing);
      else if (row.uploading && row.finished)
        tails.push(
          row.finished - row.uploading + (row.details.finalize_s ?? 12),
        );
    }
    return {
      low: round(low),
      median: Math.max(1, round(point)),
      high: Math.max(2, round(high)),
      source: legacy
        ? "legacy"
        : scaled
          ? "step_scaled"
          : coldFallback
            ? "cold_reference"
            : nearest <= 0.05
              ? "history"
              : "similar",
      samples: count,
      confidence,
      calibrated,
      tail: tails.length ? median(tails) : null,
      version: estimatorVersion,
    };
  }
}
export function elapsedDetail(
  row: Run | undefined,
  stamp: number,
): Record<string, any> | null {
  if (!row) return null;
  const end = row.finished || stamp;
  if (row.started === null)
    return {
      source:
        row.status === "running" && row.phase === "queued"
          ? "queued"
          : row.status === "legacy"
            ? "legacy"
            : "cancelled",
      total: Math.max(0, round(end - row.created)),
    };
  const start = row.started,
    details = row.details;
  const result: Record<string, any> = {
    source: "measured",
    elapsed: Math.max(0, round(end - start)),
    queue: Math.max(0, round(start - (row.queued || row.created))),
    total: Math.max(0, round(end - row.created)),
    attempt: row.attempt,
    phase_source: details.source || "observed",
    prediction: row.predicted,
  };
  const marks: [string, number | null][] = [
    ["prepare", start],
    ["generation", row.generating],
    ["finalize", row.finalizing],
    ["upload", row.uploading],
    ["validation", row.validating],
  ];
  for (let i = 0; i < marks.length; i++) {
    const [name, value] = marks[i];
    if (name === "prepare" && row.generating === null) continue;
    if (value !== null)
      result[name] = Math.max(
        0,
        round(
          (marks.slice(i + 1).find((m) => m[1] !== null)?.[1] ?? end) - value,
        ),
      );
  }
  for (const [field, name] of [
    ["prepare_s", "prepare"],
    ["generate_s", "generation"],
    ["finalize_s", "finalize"],
  ])
    if (field in details) result[name] = round(details[field]);
  if (row.status === "done" && row.predicted.median)
    result.prediction_error = result.elapsed - row.predicted.median;
  return result;
}
export function remaining(row: Run | undefined, stamp: number): Estimate {
  if (!row || row.started === null)
    return { phase: "generating", source: "none", elapsed: null };
  const prediction = row.predicted,
    elapsed = Math.max(0, stamp - row.started);
  const out: Estimate = {
    phase: row.phase,
    source: prediction.source || "none",
    elapsed: round(elapsed),
  };
  if (prediction.high)
    Object.assign(out, {
      low: Math.max(0, prediction.low - elapsed),
      median: Math.max(0, prediction.median - elapsed),
      high: Math.max(0, prediction.high - elapsed),
      overdue: elapsed > prediction.high,
    });
  const rates = row.progress.slice(1).flatMap((b, i) => {
    const a = row.progress[i];
    return a[0] >= 1 && b[0] > a[0] && b[1] > a[1]
      ? [(b[1] - a[1]) / (b[0] - a[0])]
      : [];
  });
  if (row.phase === "generating" && rates.length >= 2 && row.step < row.steps) {
    const rate = median(rates.slice(-5)),
      tail = prediction.tail != null ? Math.max(15, prediction.tail) : 60,
      left = (row.steps - row.step) * rate,
      last = row.progress.at(-1)![1],
      high = last + left * 1.3 + tail - stamp;
    Object.assign(out, {
      low: Math.max(0, last + left * 0.8 + tail * 0.5 - stamp),
      median: Math.max(0, last + left + tail - stamp),
      high: Math.max(0, high),
      overdue: high < 0,
      source: "progress",
    });
  } else if (
    ["finalizing", "uploading", "validating"].includes(row.phase) &&
    row.finalizing !== null
  ) {
    const tail = Math.max(15, prediction.tail || 60),
      elapsed = Math.max(0, stamp - row.finalizing);
    Object.assign(out, {
      low: Math.max(0, tail * 0.5 - elapsed),
      median: Math.max(0, tail - elapsed),
      high: Math.max(0, tail * 1.8 - elapsed),
      overdue: elapsed > tail * 1.8,
      source: "finishing",
      confidence: "low",
    });
  }
  return out;
}
export function planningPrediction(
  estimator: Estimator,
  target: TimingFeatures,
  node: string | null,
  runs: Run[],
  stamp: number,
): Estimate {
  const prediction = estimator.estimate(target, node);
  if (prediction.high != null && prediction.source !== "legacy")
    return prediction;
  for (const row of runs) {
    const f = row.features;
    if (!row.valid || row.status !== "running") continue;
    if (
      (
        [
          "kind",
          "executor",
          "model",
          "workflow",
          "quality",
          "video_mode",
          "width",
          "height",
          "seconds",
          "refs",
          "steps",
        ] as const
      ).some((k) => f[k] !== target[k])
    )
      continue;
    if (
      estimator.policy.hardware &&
      (target.hardware
        ? f.hardware !== target.hardware
        : row.node !== node || !!f.hardware)
    )
      continue;
    if (target.cold === true && f.cold !== true) continue;
    const eta = remaining(row, stamp);
    if (!["progress", "finishing"].includes(eta.source) || eta.overdue)
      continue;
    const elapsed = Math.max(0, stamp - row.started!);
    return {
      low: Math.max(1, round(elapsed + eta.low)),
      median: Math.max(1, round(elapsed + eta.median)),
      high: Math.max(1, round(elapsed + eta.high)),
      source: "live_progress",
      samples: 0,
      confidence: "low",
      provisional: true,
      version: estimatorVersion,
    };
  }
  return noEstimate();
}
