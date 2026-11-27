import { creditUnits } from "@fumiao/plugin-sdk/credit-amount.js";
export { creditUnits, formatCredits } from "@fumiao/plugin-sdk/credit-amount.js";

export function tokenCost(tokens: bigint, perMillion: string): bigint {
  if (tokens < 0n || !/^\d+(?:\.\d{1,6})?$/.test(perMillion))
    throw new RangeError(
      "Token 数须为非负数，单价须为至多六位小数的非负十进制数",
    );
  return tokens * (creditUnits(perMillion) / 1_000_000n);
}
