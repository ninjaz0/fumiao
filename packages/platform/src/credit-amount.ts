const SCALE = 1_000_000_000_000n;

/** Signed trillionths of a credit, including historical negative adjustments. */
export function creditUnits(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,12}))?$/.exec(value);
  if (!match) throw new RangeError("积分必须为至多十二位小数的十进制数");
  const magnitude =
    BigInt(match[2]) * SCALE + BigInt((match[3] ?? "").padEnd(12, "0"));
  return match[1] ? -magnitude : magnitude;
}

export function formatCredits(units: bigint): string {
  const magnitude = units < 0n ? -units : units;
  const fraction = (magnitude % SCALE)
    .toString()
    .padStart(12, "0")
    .replace(/0+$/, "");
  return (
    (units < 0n ? "-" : "") +
    magnitude / SCALE +
    (fraction ? "." + fraction : "")
  );
}

export function tokenCost(tokens: bigint, perMillion: string): bigint {
  if (tokens < 0n || !/^\d+(?:\.\d{1,6})?$/.test(perMillion))
    throw new RangeError(
      "Token 数须为非负数，单价须为至多六位小数的非负十进制数",
    );
  return tokens * (creditUnits(perMillion) / 1_000_000n);
}
