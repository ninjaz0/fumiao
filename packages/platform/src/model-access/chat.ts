import type { ChatMessage } from "@fumiao/plugin-sdk/chat.js";
import type { ModelTool } from "@fumiao/plugin-sdk/chat-tools.js";
import { creditUnits, formatCredits, tokenCost } from "../credit-amount.js";
import type { FrozenModelRoute, PublishedPrice } from "./publication.js";

export type ChatPrice = Extract<PublishedPrice, { kind: "chat" }>;
export type NormalizedUsage = Record<
  "input" | "cacheRead" | "cacheWrite" | "output",
  bigint
>;
export type ChatCallUsage = NormalizedUsage | null | "invalid";
const keys = ["input", "cacheRead", "cacheWrite", "output"] as const;
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error();
  return value as Record<string, unknown>;
};
/** Multiple providers report the same cumulative count under different names. */
function counter(...aliases: unknown[]) {
  let result: bigint | undefined;
  for (const value of aliases) {
    if (value == null) continue;
    if (!(
      typeof value === "bigint" ||
      (typeof value === "number" && Number.isSafeInteger(value)) ||
      (typeof value === "string" && /^\d{1,30}$/.test(value))
    ))
      throw Error();
    const n = BigInt(value);
    if (n < 0n || (result !== undefined && n !== result)) throw Error();
    result = n;
  }
  return result;
}
export function normalizeChatUsage(raw: unknown): NormalizedUsage | null {
  try {
    const r = object(raw);
    const d = object(r.prompt_tokens_details ?? {});
    const inputDetails = object(r.input_tokens_details ?? {});
    const creation = object(r.cache_creation ?? {});
    const short = counter(
      creation.ephemeral_5m_input_tokens,
      r.cache_creation_5m_input_tokens,
      r.cache_creation_5m_tokens,
      d.cache_write_5m_tokens,
    );
    const long = counter(
      creation.ephemeral_1h_input_tokens,
      r.cache_creation_1h_input_tokens,
      r.cache_creation_1h_tokens,
      d.cache_write_1h_tokens,
    );
    const write =
      counter(
        d.cache_write_tokens,
        inputDetails.cache_write_tokens,
        r.cache_creation_input_tokens,
        r.cache_write_tokens,
        short === undefined && long === undefined
          ? undefined
          : (short ?? 0n) + (long ?? 0n),
      ) ?? 0n;
    const miss = counter(r.prompt_cache_miss_tokens);
    let read = counter(
      d.cached_tokens,
      inputDetails.cached_tokens,
      r.prompt_cache_hit_tokens,
      r.cache_read_input_tokens,
    );
    // Without an inclusive total or OpenAI input details, Anthropic-style
    // input_tokens can exclude separately reported cache tokens.
    if (
      r.prompt_tokens == null &&
      r.input_tokens != null &&
      !r.input_tokens_details &&
      (r.cache_read_input_tokens != null ||
        r.cache_creation_input_tokens != null ||
        r.cache_creation != null)
    )
      return null;
    const total = counter(
      r.prompt_tokens,
      r.input_tokens,
      read !== undefined && miss !== undefined ? read + miss : undefined,
    );
    const output = counter(r.completion_tokens, r.output_tokens);
    if (total === undefined || output === undefined) return null;
    if (miss !== undefined) read = counter(read, total - miss);
    read ??= 0n;
    if (read + write > total) return null;
    counter(r.total_tokens, total + output);
    return {
      input: total - read - write,
      cacheRead: read,
      cacheWrite: write,
      output,
    };
  } catch {
    return null;
  }
}

function rates(price: ChatPrice) {
  return {
    input: price.input,
    cacheRead: price.cache_read ?? price.input,
    cacheWrite: price.cache_write ?? price.input,
    output: price.output,
  };
}
export function chatBill(
  price: ChatPrice,
  calls: ChatCallUsage[],
  held: string,
  state: string,
) {
  const unit = rates(price);
  let actual = 0n;
  const lines = keys.map((key) => {
    const tokens = calls.reduce(
      (sum, call) => sum + (call && call !== "invalid" ? call[key] : 0n),
      0n,
    );
    const cost = tokenCost(tokens, unit[key]);
    actual += cost;
    return {
      key,
      tokens: String(tokens),
      rate: unit[key],
      inherited_from:
        (key === "cacheRead" && price.cache_read === null) ||
        (key === "cacheWrite" && price.cache_write === null)
          ? "input"
          : null,
      subtotal: formatCredits(cost),
    };
  });
  const cap = creditUnits(held);
  const charged = state !== "complete" ? 0n : actual > cap ? cap : actual;
  return {
    kind: "token",
    lines,
    calls: calls.map((call) =>
      call && call !== "invalid"
        ? {
            usage: Object.fromEntries(keys.map((k) => [k, String(call[k])])),
            reason: null,
          }
        : {
            usage: null,
            reason:
              call === "invalid"
                ? "用量缺项或矛盾，未计费"
                : "用量缺失，未计费",
          },
    ),
    held: formatCredits(cap),
    charged: formatCredits(charged),
    waived: formatCredits(actual - charged),
    state,
  };
}

/** Conservative UTF-8 estimate includes message framing and tool definitions/results. */
export function chatLimit(
  price: ChatPrice,
  capabilities: FrozenModelRoute["capabilities"],
  messages: ChatMessage[],
  tools: ModelTool[],
  available: bigint,
  outputLimit?: number,
) {
  const input = Buffer.byteLength(
    JSON.stringify({ messages, ...(tools.length ? { tools } : {}) }),
  );
  const unit = rates(price);
  const maxInput = [unit.input, unit.cacheRead, unit.cacheWrite].reduce(
    (a, b) => (creditUnits(a) >= creditUnits(b) ? a : b),
  );
  const inputCost = tokenCost(BigInt(input), maxInput);
  const outputCost = tokenCost(1n, unit.output);
  let max = Math.min(
    outputLimit ??
      (outputCost ? 4096 : (capabilities.max_completion_tokens ?? 4096)),
    capabilities.max_completion_tokens ?? 4096,
    capabilities.context_length === undefined
      ? Infinity
      : capabilities.context_length - input,
  );
  if (inputCost > available) max = 0;
  else if (
    outputCost &&
    tokenCost(BigInt(Math.max(0, max)), unit.output) > available - inputCost
  )
    max = Number((available - inputCost) / outputCost);
  return {
    max_output_tokens: Math.max(0, max),
    max_charge: formatCredits(
      inputCost + BigInt(Math.max(0, max)) * outputCost,
    ),
  };
}
