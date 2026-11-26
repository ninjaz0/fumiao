import assert from "node:assert/strict";
import test from "node:test";
import { groupHistoryJobs } from "../../apps/web/studio/library-history.js";

process.env.TZ = "America/Los_Angeles";

const now = new Date("2026-01-20T20:00:00-08:00");
const job = (created: string) => ({ created: Date.parse(created) / 1000 });

test("equal month and day in different years get separate labeled groups", () => {
  const newer = job("2025-01-15T12:00:00-08:00");
  const older = job("2024-01-15T12:00:00-08:00");
  const groups = groupHistoryJobs([newer, older], now);
  assert.deepEqual(
    groups.map(({ jobs }) => jobs),
    [[newer], [older]],
  );
  assert.deepEqual(
    groups.map(({ label }) => label),
    ["2025年1月15日", "2024年1月15日"],
  );
});

test("today and adjacent days follow local midnight, not UTC", () => {
  const evening = job("2026-01-20T18:00:00-08:00");
  const morning = job("2026-01-20T08:00:00-08:00");
  const yesterday = job("2026-01-19T23:00:00-08:00");
  const groups = groupHistoryJobs([evening, morning, yesterday], now);
  assert.deepEqual(
    groups.map(({ jobs }) => jobs),
    [[evening, morning], [yesterday]],
  );
  assert.deepEqual(
    groups.map(({ label }) => label),
    ["今天", "1月19日"],
  );
});

test("empty history has no date groups", () => {
  assert.deepEqual(groupHistoryJobs([], now), []);
});

test("interleaved days retain the existing order with unique and stable group keys", () => {
  const evening = job("2026-01-20T18:00:00-08:00");
  const morning = job("2026-01-20T08:00:00-08:00");
  const yesterday = job("2026-01-19T23:00:00-08:00");
  const groups = groupHistoryJobs([evening, yesterday, morning], now);
  assert.deepEqual(groups.map(({ jobs }) => jobs), [[evening], [yesterday], [morning]]);
  const keys = groups.map(({ key }) => key);
  assert.equal(new Set(keys).size, 3);
  const next = job("2026-01-20T19:00:00-08:00");
  assert.deepEqual(groupHistoryJobs([next, evening, yesterday, morning], now).map(({ key }) => key), keys);
});
