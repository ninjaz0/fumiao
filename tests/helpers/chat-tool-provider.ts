import assert from "node:assert/strict";
import type { chatHttp } from "@fumiao/plugin-sdk/chat-transport.js";

export const toolTestOrigin = "https://1.1.1.1";
// Only replaces the transport. The published QuickJS provider constructs both
// requests and parses SSE including the usage-only event after finish_reason.
export function chatToolProvider() {
  let mode: "normal" | "bad-arguments" | "unknown" | "repeat" = "normal";
  const streams: Record<string, any>[] = [];
  const send: typeof chatHttp = async (url, init) => {
    assert.equal(url.origin, toolTestOrigin);
    const body = init.body as Record<string, any>;
    let raw: string;
    if (!body) raw = JSON.stringify({ data: [{ id: "gpt-4.1" }] });
    else if (!body.stream)
      raw = JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: "旁白估时" } }],
      });
    else {
      streams.push(body);
      const chunk = (delta: unknown, finish_reason: string | null = null) =>
        "data: " +
        JSON.stringify({ choices: [{ delta, finish_reason }] }) +
        "\n\n";
      if (body.messages.at(-1).role === "tool" && mode !== "repeat") {
        const result = JSON.parse(body.messages.at(-1).content);
        raw =
          chunk(
            { content: "旁白预计 " + result.estimatedSeconds + " 秒。" },
            "stop",
          ) +
          'data: {"choices":[],"usage":{"prompt_tokens":11,"total_tokens":15}}\n\n';
      } else if (body.tools?.length) {
        const name =
          mode === "unknown" ? "missing" : body.tools[0].function.name;
        const index = 0;
        raw =
          chunk({
            tool_calls: [
              {
                index,
                id: "call_read",
                type: "function",
                function: { name: name.slice(0, 5), arguments: '{"script":' },
              },
            ],
          }) +
          chunk(
            {
              tool_calls: [
                {
                  index,
                  function: {
                    name: name.slice(5),
                    arguments:
                      mode === "bad-arguments"
                        ? "false}"
                        : '"海面日出，海风徐来。"}',
                  },
                },
              ],
            },
            "tool_calls",
          ) +
          'data: {"choices":[],"usage":{"prompt_tokens":5,"total_tokens":9007199254740993}}\n\n';
      } else raw = chunk({ content: "普通对话" }, "stop");
      raw += "data: [DONE]\n\n";
    }
    return {
      status: 200,
      headers: {
        "content-type": body?.stream ? "text/event-stream" : "application/json",
      },
      body: (async function* () {
        const bytes = Buffer.from(raw);
        for (let i = 0; i < bytes.length; i += 7)
          yield bytes.subarray(i, i + 7);
      })(),
      close() {},
    };
  };
  return {
    send,
    streams,
    setMode(value: typeof mode) {
      mode = value;
    },
  };
}
