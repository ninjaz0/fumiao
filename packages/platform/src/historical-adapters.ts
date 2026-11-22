import { gpuText } from "@fumiao/plugin-gpu/text.js";
import { gpuPairedAgent } from "@fumiao/plugin-gpu/paired-agent.js";
import { museText } from "@fumiao/plugin-muse/text.js";
import { flowText } from "@fumiao/plugin-flow/text.js";
import { imagesText } from "@fumiao/plugin-images/text.js";
import { storyboardHistory } from "./composition/history.js";
import { museCanvasRuns } from "@fumiao/plugin-muse/canvas-runs.js";
import { museCanvas } from "@fumiao/plugin-muse/canvas.js";
import { flowCanvasRuns } from "@fumiao/plugin-flow/canvas-runs.js";
import { flowCanvas } from "@fumiao/plugin-flow/canvas.js";
import { gpuCanvasRuns } from "@fumiao/plugin-gpu/canvas-runs.js";
import { gpuCanvas } from "@fumiao/plugin-gpu/canvas.js";
import { imagesCanvasRuns } from "@fumiao/plugin-images/canvas-runs.js";
import { imagesCanvas } from "@fumiao/plugin-images/canvas.js";
import { museStudio } from "@fumiao/plugin-muse/studio.js";
import { flowStudio } from "@fumiao/plugin-flow/studio.js";
import { gpuStudio } from "@fumiao/plugin-gpu/studio.js";
import { chatStudio } from "@fumiao/plugin-chat/studio.js";
import { chatStreaming } from "@fumiao/plugin-chat/stream.js";
import { imagesStudio } from "@fumiao/plugin-images/studio.js";
import { imagesTiming } from "@fumiao/plugin-images/timing.js";
import { museTiming } from "@fumiao/plugin-muse/timing.js";
import { flowTiming } from "@fumiao/plugin-flow/timing.js";
import { gpuTiming } from "@fumiao/plugin-gpu/timing.js";
import { gpuQueue } from "@fumiao/plugin-gpu/queue.js";
import { gpuReferences } from "@fumiao/plugin-gpu/references.js";
import { gpuNative } from "@fumiao/plugin-gpu/native.js";
import { gpuOriginal } from "@fumiao/plugin-gpu/original.js";
import { museOriginal } from "@fumiao/plugin-muse/original.js";
import { imagesOriginal } from "@fumiao/plugin-images/original.js";
import { flowOriginal } from "@fumiao/plugin-flow/original.js";
import { gpuEstimate } from "@fumiao/plugin-gpu/estimate.js";
import { museEstimate } from "@fumiao/plugin-muse/estimate.js";
import { imagesEstimate } from "@fumiao/plugin-images/estimate.js";
import { flowEstimate } from "@fumiao/plugin-flow/estimate.js";
import { gpuState } from "@fumiao/plugin-gpu/state.js";
import { museState } from "@fumiao/plugin-muse/state.js";
import { flowState } from "@fumiao/plugin-flow/state.js";
import { imagesState } from "@fumiao/plugin-images/state.js";
import { imagesLifecycle } from "@fumiao/plugin-images/lifecycle.js";
import { imagesSettings } from "@fumiao/plugin-images/settings.js";
import { museDownload } from "@fumiao/plugin-muse/download.js";
import { flowDownload } from "@fumiao/plugin-flow/download.js";
import { museArtifacts } from "@fumiao/plugin-muse/artifacts.js";
import { flowArtifacts } from "@fumiao/plugin-flow/artifacts.js";
import { museLifecycle } from "@fumiao/plugin-muse/lifecycle.js";
import { flowLifecycle } from "@fumiao/plugin-flow/lifecycle.js";
import { museQueue } from "@fumiao/plugin-muse/queue.js";
import { museClock } from "@fumiao/plugin-muse/clock.js";
import { flowQueue } from "@fumiao/plugin-flow/queue.js";
import { imagesQueue } from "@fumiao/plugin-images/queue.js";
import { muse } from "@fumiao/plugin-muse/index.js";
import { flow } from "@fumiao/plugin-flow/index.js";
import { gpu } from "@fumiao/plugin-gpu/index.js";
import { storyboard } from "./composition/legacy-provider.js";
import { images } from "@fumiao/plugin-images/index.js";
import { chat } from "@fumiao/plugin-chat/index.js";
// Published Studio adapter versions. Older versions stay resolvable for accepted jobs.
export const studioReleases = [
  [museStudio, museText, "Muse2API"],
  [flowStudio, flowText, "Flow2API"],
  [gpuStudio, gpuText, "本地实例接入"],
  [imagesStudio, imagesText, "OpenAI 兼容图片"],
  [chatStudio, chatStreaming, "兼容对话"],
] as const;

export const historicalAdapters=[
      muse,
      flow,
      gpu,
      chat,
      images,
      storyboard,
      storyboardHistory,
      museStudio,
      flowStudio,
      gpuStudio,
      chatStudio,
      chatStreaming,
      imagesStudio,
      imagesTiming,
      museTiming,
      flowTiming,
      gpuTiming,
      gpuQueue,
      museQueue,
      flowQueue,
      imagesQueue,
      museClock,
      gpuReferences,
      gpuNative,
      gpuOriginal,
      museOriginal,
      imagesOriginal,
      flowOriginal,
      gpuEstimate,
      museEstimate,
      imagesEstimate,
      flowEstimate,
      gpuState,
      museState,
      flowState,
      imagesState,
      museDownload,
      flowDownload,
      museArtifacts,
      flowArtifacts,
      museLifecycle,
      flowLifecycle,
      imagesLifecycle,
      imagesSettings,
      museCanvas,
      museCanvasRuns,
      flowCanvas,
      flowCanvasRuns,
      gpuCanvas,
      gpuCanvasRuns,
      imagesCanvas,
      imagesCanvasRuns,
      gpuText,
      museText,
      flowText,
      imagesText,
    ];
export {gpuPairedAgent};
