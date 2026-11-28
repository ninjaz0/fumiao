import assert from "node:assert/strict";
import test from "node:test";
import { buildLedgerStatementPdf } from "@fumiao/original-api/billing-extras.js";

test("long balances stay intact inside the statement margins across multiple pages", () => {
  const balance = "7500000000000000.123456789012";
  const reserved = "3000000000000000.987654321098";
  const timestamp = "2026-11-27T00:00:00.000Z";
  const rows = Array.from({ length: 72 }, (_, i) => ({
    id: 1000 + i,
    action: "spend",
    amount: reserved,
    balance,
    reserved,
    createdIso: timestamp,
    note: "中文流水".repeat(15) + "END" + i,
  }));
  const bytes = buildLedgerStatementPdf({
    workspaceName: "客户工作区".repeat(20),
    workspacePublicId: 14,
    balance,
    reserved,
    generatedAtIso: timestamp,
    rows,
  });
  const pdf = bytes.toString("ascii");
  const pages = Array.from(
    pdf.matchAll(/\nstream\n(BT[\s\S]*?ET)\nendstream/g),
    ([, stream]) => {
      const lines = [...stream.matchAll(/<([\dA-F]+)> Tj/g)].map(([, hex]) =>
        Buffer.from(hex, "hex").swap16().toString("utf16le"),
      );
      const size = Number(stream.match(/\/F1 ([\d.]+) Tf/)![1]);
      const leading = Number(stream.match(/([\d.]+) TL/)![1]);
      const [, x, y] = stream.match(/([\d.]+) ([\d.]+) Td/)!;
      for (const line of lines) {
        const end = [...line].reduce(
          (pos, ch) => pos + (ch.charCodeAt(0) > 127 ? size : size / 2),
          Number(x),
        );
        assert.ok(end <= 612 - 24, `line ends at x=${end}: ${line}`);
      }
      assert.ok(
        Number(y) - (lines.length - 1) * leading >= 24,
        "footer within page",
      );
      return lines;
    },
  );
  assert.ok(pages.length > 2);
  assert.ok(
    pages.flat().some((line) => line.includes("4499999999999999.135802467914")),
  );
  const lines = pages.flat().join("\n");
  assert.ok(
    lines.split(balance).length - 1 >= rows.length + 1,
    "each row preserves its full balance",
  );
  assert.ok(
    lines.split("-" + reserved).length - 1 >= rows.length,
    "each spend preserves its full amount",
  );
  for (let i = 0; i < rows.length; i++)
    assert.ok(lines.includes("END" + i), "row " + i);
});
