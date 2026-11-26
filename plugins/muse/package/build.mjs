import { packageRequestPolicy } from "../../../scripts/package-request-policy.mjs";
import { museText } from "../src/text.ts";
await packageRequestPolicy(
  museText,
  process.argv[2],
  {
    imageFormat: "Muse 返回的图片格式或尺寸无效",
    imageDecode: "Muse 成品保存失败，请检查后重新生成",
    video: "Muse 返回的视频无法验证或方向异常",
    failed: "Muse 成品保存失败，请检查后重新生成",
  },
  { priorTimingVersions: ["2.0.0"], queueVersion: 2 },
);
