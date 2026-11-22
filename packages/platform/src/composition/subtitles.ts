import { pythonStrip } from "@fumiao/plugin-sdk/python-values.js";
/** Sentence-weighted captions, matching the original compositor (not ASR). */
export function timestamp(seconds: number): string {
  // Python round uses ties-to-even, unlike Math.round.
  const value = seconds * 1000;
  const floor = Math.floor(value);
  let ms = value - floor === 0.5 ? floor + (floor % 2) : Math.round(value);
  const h = Math.floor(ms / 3600000);
  ms %= 3600000;
  const m = Math.floor(ms / 60000);
  ms %= 60000;
  const s = Math.floor(ms / 1000);
  ms %= 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}
export function subtitleCues(
  text: string,
  offset: number,
  length: number,
  start: number,
): string[] {
  const parts = text
    .split(/(?<=[。！？!?；;])|\n+/u)
    .map((p) => pythonStrip(p))
    .filter(Boolean);
  const total = parts.reduce((n, p) => n + Array.from(p).length, 0);
  let cursor = offset;
  return parts.map((part, index) => {
    const end = cursor + (length * Array.from(part).length) / total;
    const cue = `${start + index}\n${timestamp(cursor)} --> ${timestamp(end)}\n${part}\n`;
    cursor = end;
    return cue;
  });
}
export function webVtt(srt: string): string {
  return "WEBVTT\n\n" + srt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
}
