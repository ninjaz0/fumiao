import { parentPort, workerData } from "node:worker_threads";
import { tsImport } from "tsx/esm/api";
if (["provider", "generated-png"].includes(workerData.mode)) {
  const { inspectProviderImage, ProviderImageError } = await tsImport(
    "./provider.ts",
    import.meta.url,
  );
  try {
    const result = await inspectProviderImage(
      workerData.input,
      workerData.mode === "generated-png",
    );
    parentPort.postMessage({ ok: true, result });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      provider: error instanceof ProviderImageError ? error.kind : "decode",
    });
  }
} else {
  const { convertImage, ImageImportError } = await tsImport(
    "./convert.ts",
    import.meta.url,
  );
  try {
    const result = await convertImage(
      workerData.input,
      workerData.output,
      workerData.mode,
    );
    parentPort.postMessage({ ok: true, result });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      domain: error instanceof ImageImportError,
      message:
        error instanceof ImageImportError ? error.message : "请求处理失败",
    });
  }
}
parentPort.close();
