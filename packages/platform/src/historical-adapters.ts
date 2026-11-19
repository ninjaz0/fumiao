import { gpuText } from "../../../plugins/gpu/src/text.js";
import { gpuPairedAgent } from "../../../plugins/gpu/src/paired-agent.js";
import { museText } from "../../../plugins/muse/src/text.js";
import { flowText } from "../../../plugins/flow/src/text.js";
import { imagesText } from "../../../plugins/images/src/text.js";
import { storyboardHistory } from "../../../plugins/storyboard/src/history.js";
import { museCanvasRuns } from "../../../plugins/muse/src/canvas-runs.js";
import { museCanvas } from "../../../plugins/muse/src/canvas.js";
import { flowCanvasRuns } from "../../../plugins/flow/src/canvas-runs.js";
import { flowCanvas } from "../../../plugins/flow/src/canvas.js";
import { gpuCanvasRuns } from "../../../plugins/gpu/src/canvas-runs.js";
import { gpuCanvas } from "../../../plugins/gpu/src/canvas.js";
import { imagesCanvasRuns } from "../../../plugins/images/src/canvas-runs.js";
import { imagesCanvas } from "../../../plugins/images/src/canvas.js";
import { museStudio } from "../../../plugins/muse/src/studio.js";
import { flowStudio } from "../../../plugins/flow/src/studio.js";
import { gpuStudio } from "../../../plugins/gpu/src/studio.js";
import { chatStudio } from "../../../plugins/chat/src/studio.js";
import { chatStreaming } from "../../../plugins/chat/src/stream.js";
import { imagesStudio } from "../../../plugins/images/src/studio.js";
import { imagesTiming } from "../../../plugins/images/src/timing.js";
import { museTiming } from "../../../plugins/muse/src/timing.js";
import { flowTiming } from "../../../plugins/flow/src/timing.js";
import { gpuTiming } from "../../../plugins/gpu/src/timing.js";
import { gpuQueue } from "../../../plugins/gpu/src/queue.js";
import { gpuReferences } from "../../../plugins/gpu/src/references.js";
import { gpuNative } from "../../../plugins/gpu/src/native.js";
import { gpuOriginal } from "../../../plugins/gpu/src/original.js";
import { museOriginal } from "../../../plugins/muse/src/original.js";
import { imagesOriginal } from "../../../plugins/images/src/original.js";
import { flowOriginal } from "../../../plugins/flow/src/original.js";
import { gpuEstimate } from "../../../plugins/gpu/src/estimate.js";
import { museEstimate } from "../../../plugins/muse/src/estimate.js";
import { imagesEstimate } from "../../../plugins/images/src/estimate.js";
import { flowEstimate } from "../../../plugins/flow/src/estimate.js";
import { gpuState } from "../../../plugins/gpu/src/state.js";
import { museState } from "../../../plugins/muse/src/state.js";
import { flowState } from "../../../plugins/flow/src/state.js";
import { imagesState } from "../../../plugins/images/src/state.js";
import { imagesLifecycle } from "../../../plugins/images/src/lifecycle.js";
import { imagesSettings } from "../../../plugins/images/src/settings.js";
import { museDownload } from "../../../plugins/muse/src/download.js";
import { flowDownload } from "../../../plugins/flow/src/download.js";
import { museArtifacts } from "../../../plugins/muse/src/artifacts.js";
import { flowArtifacts } from "../../../plugins/flow/src/artifacts.js";
import { museLifecycle } from "../../../plugins/muse/src/lifecycle.js";
import { flowLifecycle } from "../../../plugins/flow/src/lifecycle.js";
import { museQueue } from "../../../plugins/muse/src/queue.js";
import { museClock } from "../../../plugins/muse/src/clock.js";
import { flowQueue } from "../../../plugins/flow/src/queue.js";
import { imagesQueue } from "../../../plugins/images/src/queue.js";
import { muse } from "../../../plugins/muse/src/index.js";
import { flow } from "../../../plugins/flow/src/index.js";
import { gpu } from "../../../plugins/gpu/src/index.js";
import { storyboard } from "../../../plugins/storyboard/src/index.js";
import { images } from "../../../plugins/images/src/index.js";
import { chat } from "../../../plugins/chat/src/index.js";
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
