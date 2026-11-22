import { readFileSync } from "node:fs";
import {
  PairedAgentPlanError,
  type PairedAgentProtocol,
} from "@fumiao/plugin-sdk/paired-agent.js";
import { hardwareSignature } from "./timing.js";
import { canRunQueueJob } from "./queue.js";
import { validateReport } from "./artifacts.js";

const video = "MiniMax H3",
  audio = "breeze-tts-2";
const models = JSON.parse(
  readFileSync(new URL("../models.json", import.meta.url), "utf8"),
) as Record<
  string,
  {
    label: string;
    backends: string[];
    min_ram_gib: number;
    min_vram_gib: number;
  }
>;
const fail = (detail: string): never => {
  throw new PairedAgentPlanError(detail);
};
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

export const gpuPairedAgent: PairedAgentProtocol = {
  provider: "gpu",
  version: 2,
  legacyModel: video,
  models,
  canRun: canRunQueueJob,
  preflight: validateReport,
  hardware: hardwareSignature,
  plan(value, selected) {
    if (value.mode === "serial")
      return { mode: "serial", policy: "gpu-budget-v1" };
    if (value.mode !== "parallel") return fail("执行计划无效");
    const {
      lanes,
      reserve_vram_gib: reserves,
      ram_total_gib: totalRam,
      reserve_ram_gib: reserveRam,
    } = value;
    if (!object(lanes)) return fail("执行通道格式无效");
    if (
      value.policy !== "gpu-budget-v1" ||
      Object.keys(lanes).length !== 2 ||
      ![video, audio].every(
        (model) => Object.hasOwn(lanes, model) && selected.includes(model),
      )
    )
      return fail("并发模型计划与实例授权不符");
    if (!object(reserves)) return fail("显存预算格式无效");
    if (
      !positive(totalRam) ||
      totalRam > 65536 ||
      !positive(reserveRam) ||
      reserveRam > 65536
    )
      return fail("系统内存预算无效");
    const devices = new Map<string, { total: number; budget: number }>();
    const budgets = new Map<string, number>();
    let ram = 0;
    for (const [model, lane] of Object.entries(lanes)) {
      if (!object(lane)) return fail("执行通道格式无效");
      const {
        backend,
        device,
        gpu_total_gib: total,
        gpu_budget_gib: gpu,
        ram_budget_gib: memory,
      } = lane;
      const spec = models[model];
      if (
        typeof backend !== "string" ||
        !spec.backends.includes(backend) ||
        typeof device !== "number" ||
        !Number.isInteger(device) ||
        device < 0 ||
        device >= 128
      )
        return fail("并发设备无效");
      if (!positive(total) || !positive(gpu) || !positive(memory))
        return fail("资源预算无效");
      if (total < spec.min_vram_gib || memory < spec.min_ram_gib)
        return fail("模型资源预算不足");
      const previous = devices.get(String(device));
      if (previous && previous.total !== total)
        return fail("同卡资源预算超出显存");
      devices.set(String(device), {
        total,
        budget: (previous?.budget ?? 0) + gpu,
      });
      budgets.set(model, gpu);
      ram += memory;
    }
    for (const [device, { total, budget }] of devices) {
      const reserve = reserves[device];
      if (!positive(reserve) || reserve < 2) return fail("需要保留显存余量");
      if (reserve + budget > total) return fail("同卡资源预算超出显存");
    }
    const shared = devices.size === 1;
    if (reserveRam < (shared ? 32 : 16) || totalRam < ram + reserveRam)
      return fail("并发系统内存不足");
    if (
      shared &&
      (budgets.get(video)! < 128 ||
        budgets.get(audio)! < 12 ||
        Number(reserves[devices.keys().next().value!]) < 16)
    )
      return fail("同卡并发预算不足");
    return {
      mode: "parallel",
      policy: value.policy,
      lanes,
      ram_total_gib: totalRam,
      reserve_ram_gib: reserveRam,
      reserve_vram_gib: reserves,
      shared_gpu: shared,
    };
  },
};
