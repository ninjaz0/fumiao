import test from "node:test";
import assert from "node:assert/strict";
import {
  PluginHost,
  hostLimits,
  type HttpTransport,
} from "@fumiao/platform/plugin-host.js";
import { runProgram } from "@fumiao/platform/plugin-program.js";
import { contributesSchema } from "@fumiao/plugin-sdk/contributions.js";
function host(http: HttpTransport) {
  return new PluginHost(
    { query: () => assert.fail("unexpected SQL") },
    {
      pluginId: "test-http-stream",
      workspace: "test",
      mode: "write",
      scopes: [],
      contributions: contributesSchema.parse({
        version: 1,
        hostCapabilities: ["http"],
        http: { origins: ["https://stream.example"] },
      }),
    },
    http,
  );
}
test("sandbox reads incremental UTF-8, including a codepoint split across chunks", async () => {
  const bytes = Buffer.from("答复");
  const h = host(async () => ({
    status: 200,
    contentType: "text/event-stream",
    body: new ReadableStream({
      start(c) {
        c.enqueue(bytes.subarray(0, 1));
        c.enqueue(bytes.subarray(1));
        c.close();
      },
    }),
  }));
  const result = await runProgram(
    '({async read(host){const r=await host.http.openStream("https://stream.example/sse"); let text="",chunk;do{chunk=await host.http.readStream();text+=chunk.text}while(!chunk.done);return [r.status,text]}})',
    "read",
    [],
    h.granted,
    h.call,
  );
  assert.deepEqual(result, [200, "答复"]);
});
test("returning early releases the unread HTTP response; limits span chunks", async () => {
  let cancelled = false;
  let h = host(async () => ({
    status: 200,
    contentType: "text/plain",
    body: new ReadableStream({
      cancel() {
        cancelled = true;
      },
    }),
  }));
  await runProgram(
    '({async read(host){await host.http.openStream("https://stream.example");return true}})',
    "read",
    [],
    h.granted,
    h.call,
  );
  assert.ok(cancelled);
  h = host(async () => ({
    status: 200,
    contentType: "text/plain",
    body: new ReadableStream({
      start(c) {
        c.enqueue(Buffer.alloc(hostLimits.httpResponseBytes, 97));
        c.enqueue(Buffer.from("a"));
        c.close();
      },
    }),
  }));
  const signal = new AbortController().signal;
  await h.call("http.openStream", ["https://stream.example"], signal);
  await h.call("http.readStream", [], signal);
  await assert.rejects(h.call("http.readStream", [], signal), /响应过大/);
});
test("streaming enforces the declared HTTPS origin before calling transport", async () => {
  const h = host(async () => assert.fail("unexpected network"));
  await assert.rejects(
    h.call(
      "http.openStream",
      ["https://other.example/"],
      new AbortController().signal,
    ),
    /声明的范围/,
  );
});
