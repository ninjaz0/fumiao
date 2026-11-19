import { readFile } from "node:fs/promises";
import { runtime } from "../packages/platform/src/runtime.js";
import { importLegacy } from "../packages/platform/src/importer.js";
import { checkStudioStorage } from "../packages/platform/src/studio-runtime.js";
if (!process.env.LEGACY_EXPORT || !process.env.LEGACY_OBJECTS)
  throw new Error("需要 LEGACY_EXPORT 与 LEGACY_OBJECTS（本地导出的媒体目录）");
await checkStudioStorage(process.env);
const p = runtime();
try {
  const data = JSON.parse(await readFile(process.env.LEGACY_EXPORT, "utf8"));
  if (data.chatVersion !== 1)
    throw new Error(
      "导出文件缺少完整对话版本，请使用当前 export-legacy.py 重新导出到新的隔离目标库",
    );
  if (data.canvasVersion !== 1)
    throw new Error(
      "导出文件缺少完整画布版本，请使用当前 export-legacy.py 重新导出到新的隔离目标库",
    );
  if (data.stateVersion !== 1)
    throw new Error(
      "导出文件缺少完整状态版本，请使用当前 export-legacy.py 重新导出到新的隔离目标库",
    );
  if (
    process.env.STUDIO_LEGACY_SOURCE &&
    data.source !== process.env.STUDIO_LEGACY_SOURCE
  )
    throw new Error("导出文件的来源与配置中的 STUDIO_LEGACY_SOURCE 不符");
  console.log(
    await importLegacy(p, data, process.env.LEGACY_OBJECTS, {
      avatars: process.env.LEGACY_AVATARS,
    }),
  );
} finally {
  await p.db.close();
}
