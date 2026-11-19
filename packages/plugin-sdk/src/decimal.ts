/** Python round(value, digits): round the exact binary float, ties to even. */
export function roundDecimal(value: number, digits: number) {
  if (!Number.isFinite(value) || value === 0) return value;
  if (!Number.isInteger(digits) || digits < 0 || digits > 12)
    throw Error("Unsupported decimal precision");
  const data = new DataView(new ArrayBuffer(8));
  data.setFloat64(0, value);
  const bits = data.getBigUint64(0),
    negative = bits >> 63n !== 0n,
    exponent = Number((bits >> 52n) & 2047n),
    fraction = bits & ((1n << 52n) - 1n);
  const numerator =
      (exponent ? fraction + (1n << 52n) : fraction) * 10n ** BigInt(digits),
    shift = (exponent || 1) - 1023 - 52;
  if (shift >= 0) return value;
  const denominator = 1n << BigInt(-shift),
    whole = numerator / denominator,
    remainder = numerator % denominator;
  const result =
    whole +
    (remainder * 2n > denominator ||
    (remainder * 2n === denominator && whole % 2n === 1n)
      ? 1n
      : 0n);
  return Number((negative ? "-" : "") + result + "e-" + digits);
}
