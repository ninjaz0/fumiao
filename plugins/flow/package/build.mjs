import { packageRequestPolicy } from "../../../scripts/package-request-policy.mjs";
import { flowText } from "../src/text.ts";
await packageRequestPolicy(
  flowText,
  process.argv[2],
  {
    imageFormat: "Flow 返回的图片格式或尺寸无效",
    imageDecode: "Flow 生成或保存失败，请从后台检查结果后重试",
    video: "Flow 返回的视频无法验证或方向异常",
    failed: "Flow 生成或保存失败，请从后台检查结果后重试",
    recovering: "Flow 成品保存失败，请从后台检查生成结果",
  },
  {
    stream: "sse",
    artifactOrigins: [
      "https://storage.googleapis.com",
      "https://flow-content.google",
      "https://*.googleusercontent.com",
    ],
  },
);
