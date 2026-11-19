import type {
  QueueId,
  QueueEstimate,
  QueuePlans,
  QueueSlot,
  SlotSchedule,
} from "../../plugin-sdk/src/queue.js";
import { estimatorVersion, round, median } from "./timing-math.js";

export function compareQueueIds(a: QueueId, b: QueueId) {
  return typeof a === "number" && typeof b === "number"
    ? a - b
    : String(a) < String(b)
      ? -1
      : String(a) > String(b)
        ? 1
        : 0;
}
// CPython round(x, 2) rounds the exact binary float, not x*100. The distinction
// affects branch de-duplication at decimal ties such as 2.675.
export function roundHundredths(value: number) {
  if (!Number.isFinite(value) || value === 0) return value;
  const data = new DataView(new ArrayBuffer(8));
  data.setFloat64(0, value);
  const bits = data.getBigUint64(0),
    negative = bits >> 63n !== 0n,
    exponent = Number((bits >> 52n) & 2047n),
    fraction = bits & ((1n << 52n) - 1n);
  let numerator = (exponent ? fraction + (1n << 52n) : fraction) * 100n,
    shift = (exponent || 1) - 1023 - 52;
  if (shift >= 0) return value;
  const denominator = 1n << BigInt(-shift),
    whole = numerator / denominator,
    remainder = numerator % denominator;
  const result =
    whole +
    (remainder * 2n > denominator ||
    (remainder * 2n === denominator && whole % 2n === 1n)
      ? 1n
      : 0n);
  return Number((negative ? "-" : "") + result.toString() + "e-2");
}
const modeKey = (modes: (string | null)[]) =>
  modes.map((m) => (m === null ? "None" : m)).sort();
const upper = (values: (number | null)[]) =>
  values.every((v) => v !== null) ? Math.max(...(values as number[])) : null;

/** Forecast only: it preserves all plausible next claimants, never reserves or
 * dispatches a task. Runtime eligibility and cache keys belong to plugins. */
export function scheduleSlots(input: SlotSchedule): QueuePlans {
  const initial = input.slots,
    plans: QueuePlans = Object.create(null),
    waiting = [...input.waiting].sort((a, b) => compareQueueIds(a.id, b.id));
  let states = [initial],
    expected = initial,
    merged = false;
  const cache = new Map<string, QueueEstimate>();
  for (const [ahead, job] of waiting.entries()) {
    const eligible = (slot: QueueSlot) => input.eligible(slot, job),
      mode = input.mode(job);
    if (!initial.some(eligible)) {
      plans[job.id] = { source: "none", reason: input.unavailable(job), ahead };
      continue;
    }
    const predict = (slot: QueueSlot) => {
      const key = JSON.stringify([
        job.id,
        slot.node?.id ?? null,
        modeKey(slot.modes),
      ]);
      if (!cache.has(key)) {
        const predictions = slot.modes.map((m) => input.predict(job, slot, m));
        cache.set(
          key,
          predictions.some((p) => p.high == null)
            ? { source: "none", samples: 0, confidence: "none" }
            : {
                ...predictions[0],
                low: Math.min(...predictions.map((p) => p.low)),
                median: round(median(predictions.map((p) => p.median))),
                high: Math.max(...predictions.map((p) => p.high)),
              },
        );
      }
      return cache.get(key)!;
    };
    const known = expected
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => eligible(s) && s.median !== null);
    let expectedStart: number | null = null,
      expectedPrediction: QueueEstimate | undefined;
    if (known.length) {
      const { s: slot, i: chosen } = known.sort(
        (a, b) =>
          a.s.median! - b.s.median! ||
          compareQueueIds(a.s.node?.id ?? 0, b.s.node?.id ?? 0),
      )[0];
      expectedStart = slot.median!;
      expectedPrediction = predict(slot);
      expected = expected.map((s, i) =>
        i === chosen
          ? {
              ...slot,
              median:
                expectedPrediction!.median != null
                  ? expectedStart! + expectedPrediction!.median
                  : null,
              modes: [mode],
            }
          : s,
      );
    }
    const waits: { low: number; high: number | null }[] = [],
      durations: QueueEstimate[] = [],
      completions: { low: number; high: number | null }[] = [],
      nextStates: QueueSlot[][] = [],
      candidates = new Set<QueueId | null>();
    for (const slots of states) {
      const highs = slots
          .filter((s) => eligible(s) && s.high !== null)
          .map((s) => s.high!),
        ceiling = highs.length ? Math.min(...highs) : null;
      for (const [index, slot] of slots.entries()) {
        if (!eligible(slot) || (ceiling !== null && slot.low > ceiling))
          continue;
        const start = {
          low: slot.low,
          high: ceiling === null ? null : ceiling + 5,
        };
        waits.push(start);
        candidates.add(slot.node?.id ?? null);
        const p = predict(slot);
        durations.push(p);
        const finish = {
          low: start.low + (p.low ?? 0),
          high:
            start.high !== null && p.high != null ? start.high + p.high : null,
        };
        completions.push(finish);
        nextStates.push(
          slots.map((s, i) =>
            i === index
              ? { ...slot, low: finish.low, high: finish.high, modes: [mode] }
              : eligible(s)
                ? { ...s, low: Math.max(s.low, start.low) }
                : s,
          ),
        );
      }
    }
    const high = upper(waits.map((w) => w.high)),
      low = Math.min(...waits.map((w) => w.low));
    const plan: QueueEstimate = {
      source: high !== null ? "queue" : "none",
      reason: high !== null ? null : "observing",
      low: round(low),
      median:
        expectedStart === null
          ? null
          : round(
              Math.max(low, Math.min(expectedStart, high ?? expectedStart)),
            ),
      high: high === null ? null : round(high),
      ahead,
      node_ids: [...candidates]
        .filter((n): n is QueueId => n !== null)
        .sort(compareQueueIds),
      confidence: "low",
      merged,
      version: estimatorVersion,
    };
    if (durations.every((p) => p.high != null))
      plan.duration = {
        low: Math.min(...durations.map((p) => p.low)),
        high: Math.max(...durations.map((p) => p.high)),
        median: round(
          expectedPrediction?.median ?? median(durations.map((p) => p.median)),
        ),
        source: durations.some((p) => p.provisional)
          ? "live_progress"
          : candidates.size > 1
            ? "multi_instance"
            : durations[0].source,
        samples: Math.min(...durations.map((p) => p.samples ?? 0)),
        confidence:
          candidates.size > 1 ? "low" : (durations[0].confidence ?? "low"),
        version: estimatorVersion,
      };
    if (completions.every((p) => p.high !== null))
      plan.finish = {
        low: round(Math.min(...completions.map((p) => p.low))),
        high: round(Math.max(...completions.map((p) => p.high!))),
      };
    plans[job.id] = plan;
    const unique = new Map<string, QueueSlot[]>();
    for (const slots of nextStates)
      unique.set(
        JSON.stringify(
          slots.map((s) => [
            roundHundredths(s.low),
            s.high === null ? null : roundHundredths(s.high),
            modeKey(s.modes),
          ]),
        ),
        slots,
      );
    states = [...unique.values()];
    if (states.length > 32) {
      merged = true;
      states = [
        initial.map((s, i) => ({
          ...s,
          low: Math.min(...states.map((v) => v[i].low)),
          high: upper(states.map((v) => v[i].high)),
          modes: [...new Set(states.flatMap((v) => v[i].modes))],
        })),
      ];
    }
  }
  return plans;
}
