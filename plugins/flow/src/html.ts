// HTML5 names from Python 3.12 html.entities. See ../html5 for provenance and license.
import entities from "../html5/html5-entities.json" with { type: "json" };
const names: Record<string, string> = entities;
const windows = [
  8364, 129, 8218, 402, 8222, 8230, 8224, 8225, 710, 8240, 352, 8249, 338, 141,
  381, 143, 144, 8216, 8217, 8220, 8221, 8226, 8211, 8212, 732, 8482, 353, 8250,
  339, 157, 382, 376,
];
export function flowUnescape(text: string) {
  return text.replace(
    /&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[^\t\n\f <&#;]{1,32};?)/gu,
    (_, ref: string) => {
      if (ref[0] !== "#") {
        for (let n = ref.length; n > 1; n--)
          if (Object.hasOwn(names, ref.slice(0, n)))
            return names[ref.slice(0, n)] + ref.slice(n);
        return "&" + ref;
      }
      const hex = /^#[xX]/.test(ref),
        digits = ref.slice(hex ? 2 : 1).replace(/;$/, ""),
        value = Number.parseInt(digits, hex ? 16 : 10);
      if (!hex && digits.length > 4300)
        throw new Error("Invalid character reference");
      if (
        value === 0 ||
        value > 0x10ffff ||
        (value >= 0xd800 && value <= 0xdfff)
      )
        return "\ufffd";
      if (value >= 128 && value <= 159)
        return String.fromCodePoint(windows[value - 128]);
      if (
        (value >= 1 && value <= 8) ||
        value === 11 ||
        (value >= 14 && value <= 31) ||
        value === 127 ||
        (value >= 0xfdd0 && value <= 0xfdef) ||
        (value & 0xffff) >= 0xfffe
      )
        return "";
      return String.fromCodePoint(value);
    },
  );
}
