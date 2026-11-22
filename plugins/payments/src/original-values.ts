import {
  decodePythonJson,
  pythonJsonText,
} from "@fumiao/plugin-sdk/json.js";

export type PaymentValues = Record<string, unknown>;

/** Keep JSON number source text until signature and amount validation finish. */
class PaymentNumber {
  constructor(readonly source: string) {}

  toString() {
    return this.source;
  }
}

export function paymentObject(value: unknown): PaymentValues {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value instanceof PaymentNumber
  )
    throw new Error("Invalid payment object");
  return value as PaymentValues;
}

export function paymentJson(bytes: Buffer, unique = false): PaymentValues {
  const source = decodePythonJson(bytes);
  const values = paymentObject(
    pythonJsonText(source, (_key, value, context) => {
      if (typeof value === "number" && context.source)
        return new PaymentNumber(context.source);
      return value;
    }),
  );
  if (unique) {
    // Syntax has already been checked. Walk structural tokens and decoded object
    // keys so duplicate names cannot be hidden by escapes or overwritten by JSON.parse.
    const scopes: (Set<string> | null)[] = [];
    const tokens = source.matchAll(/"(?:[^"\\]|\\[\s\S])*"\s*:?|[{}\[\]]/g);
    for (const [token] of tokens) {
      if (token === "{") scopes.push(new Set());
      else if (token === "[") scopes.push(null);
      else if (token === "}" || token === "]") scopes.pop();
      else if (token.endsWith(":")) {
        const key = JSON.parse(token.slice(0, -1)) as string;
        const scope = scopes.at(-1)!;
        if (scope.has(key)) throw new Error("Duplicate payment field");
        scope.add(key);
      }
    }
  }
  return values;
}

function decimal(value: string) {
  const parts = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(
    value.trim().replaceAll("_", ""),
  );
  if (!parts || !(parts[2] || parts[3])) throw new Error("Invalid decimal");
  const [, sign, whole, fraction = "", exponent = "0"] = parts;
  const significant = (whole + fraction).replace(/^0+/, "");
  const digits = significant.replace(/0+$/, "");
  const power =
    Number(exponent) - fraction.length + significant.length - digits.length;
  return { negative: sign === "-", digits, power };
}

export function originalFen(value: unknown) {
  if (!(typeof value === "string" || value instanceof PaymentNumber))
    throw new Error("Invalid payment amount");
  const { negative, digits, power } = decimal(String(value));
  if (negative || !digits || power < -2 || digits.length + power + 2 > 16)
    throw new Error("Invalid payment amount");
  const fen = Number(digits + "0".repeat(power + 2));
  if (!Number.isSafeInteger(fen)) throw new Error("Invalid payment amount");
  return fen;
}

export function paymentScalar(value: unknown) {
  if (typeof value === "string" && !/[\uD800-\uDFFF]/u.test(value))
    return value;
  if (!(value instanceof PaymentNumber))
    throw new Error("Invalid signed value");
  if (/^-?\d+$/.test(value.source)) return BigInt(value.source).toString();
  const { negative, digits, power } = decimal(value.source);
  if (!digits) return negative ? "-0" : "0";
  // Bound canonical strings before expansion of exponent notation.
  if (Math.abs(power) + digits.length > 131072)
    throw new Error("Signed value is too large");
  const point = digits.length + power;
  const normalized =
    power >= 0
      ? digits + "0".repeat(power)
      : point > 0
        ? digits.slice(0, point) + "." + digits.slice(point)
        : "0." + "0".repeat(-point) + digits;
  return (negative ? "-" : "") + normalized;
}

export function paymentStatus(value: unknown, expected: string) {
  if (value instanceof PaymentNumber && /^-?\d+$/.test(value.source))
    return paymentScalar(value) === expected;
  return value === expected;
}

export function paymentStatusNumber(value: unknown, expected: string) {
  return value instanceof PaymentNumber && paymentScalar(value) === expected;
}

export function paymentExpiry(value: unknown) {
  const expiry =
    value instanceof PaymentNumber
      ? Math.trunc(Number(value.source))
      : typeof value === "string" && /^\s*[+-]?\d+\s*$/.test(value)
        ? Number(value)
        : typeof value === "boolean"
          ? Number(value)
          : NaN;
  if (!Number.isSafeInteger(expiry)) throw new Error("Invalid payment expiry");
  return expiry > 10 ** 12 ? Math.floor(expiry / 1000) : expiry;
}
