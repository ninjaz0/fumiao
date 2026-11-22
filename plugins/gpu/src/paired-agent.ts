import { lanePlan } from "./lane-plan.js";
import { readFileSync } from "node:fs";
import { type PairedAgentProtocol } from "@fumiao/plugin-sdk/paired-agent.js";
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
export const gpuPairedAgent: PairedAgentProtocol = {
  provider: "gpu",
  version: 2,
  legacyModel: video,
  models,
  canRun: canRunQueueJob,
  preflight: validateReport,
  hardware: hardwareSignature,
  plan: lanePlan,
};
