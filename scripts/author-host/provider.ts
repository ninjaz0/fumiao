import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { receiptSchema, type Manifest } from "@fumiao/plugin-sdk/index.js";

// Only the author's explicitly selected local fixture receives synthetic jobs.
export async function verifyLocalProvider(manifest: Manifest, service: string) {
  const url = new URL(service);
  assert.ok(
    url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      url.origin === service,
    "--service 需要 http://127.0.0.1:<端口>",
  );
  const credential = process.env.PLUGIN_KEY;
  assert.ok(credential, "请通过 PLUGIN_KEY 提供本机模拟服务使用的测试口令");
  const headers = {
    authorization: "Bearer " + credential,
    "content-type": "application/json",
  };
  const request = (path: string, options: RequestInit = {}) =>
    fetch(new URL(path, url), {
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      headers,
      ...options,
    });
  assert.ok((await request("/health")).ok, "提供方健康检查失败");
  for (const model of manifest.models) {
    const jobId = randomUUID();
    const params = Object.fromEntries(
      Object.entries(
        (model.inputSchema.properties ?? {}) as Record<
          string,
          { default?: unknown; const?: unknown; enum?: unknown[] }
        >,
      ).flatMap(([key, field]) => {
        const sample = field.default ?? field.const ?? field.enum?.[0];
        return sample === undefined ? [] : [[key, sample]];
      }),
    );
    const envelope = {
      jobId,
      idempotencyKey: jobId,
      model: model.id,
      kind: model.kind,
      input: { prompt: "工作台示例", params, references: [] },
      config: {},
    };
    const post = async (path: string, body: unknown) => {
      const response = await request(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      assert.ok(
        response.ok,
        model.id + " " + path + " HTTP " + response.status,
      );
      return receiptSchema.parse(await response.json());
    };
    const receipt = await post("/submit", envelope);
    assert.notEqual(receipt.state, "failed", model.id + " 拒绝了示例任务");
    if (receipt.state === "pending") {
      const next = await post("/inspect", {
        ...envelope,
        remoteId: receipt.remoteId,
      });
      assert.notEqual(next.state, "failed", model.id + " 查询任务失败");
    }
    console.log("通过 providers." + model.id + ".service");
  }
}
