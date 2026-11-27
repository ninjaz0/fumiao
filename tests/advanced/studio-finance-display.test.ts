import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { evaluateCreditAdjustment } from "../../apps/web/studio/settings-credits-helpers.js";
import type { StudioState } from "../../apps/web/studio/state.js";

Object.assign(globalThis, { React });
// The settings dialog imports styles that the web bundler normally handles.
createRequire(import.meta.url).extensions[".css"] = () => {};
const creditsModule = "../../apps/web/studio/SettingsCredits.tsx";
const { Credits } = await import(creditsModule);
const adminModule = "../../apps/web/studio/SettingsCreditAdmin.tsx";
const { CreditAdmin } = await import(adminModule);
const noop = () => {};
const wallet = {
  available: 12000,
  reserved: 0.000000000001,
  exact: {
    available: "11999.999999999999",
    reserved: "0.000000000001",
    balance: "12000",
  },
};

test("member credit settings preserve every decimal in the wallet and the ledger balance after a spend", () => {
  const state = {
    credits: wallet,
    workspace_id: 23,
    credit_history: [
      {
        id: 2,
        created: 5,
        action: "spend",
        amount: 1e-12,
        balance: 10000,
        exact: {
          amount: "0.000000000001",
          balance: "9999.999999999999",
          reserved: "0",
        },
      },
      { id: 1, created: 4, action: "adjust", amount: 10 },
    ],
  } as unknown as StudioState;
  const output = renderToStaticMarkup(
    createElement(Credits, {
      state,
      recharge: noop,
      history: noop,
      notify: noop,
    }),
  );
  for (const expected of [
    "11,999.999999999999",
    "0.000000000001",
    "−0.000000000001",
    "9,999.999999999999",
    "+10",
  ])
    assert.ok(output.includes(expected), expected);
});

test("administrative account totals add exact decimals and keep whole credits legible", () => {
  const accounts = [
    {
      workspace: 1,
      kind: "team" as const,
      name: "A",
      username: null,
      ...wallet,
    },
    {
      workspace: 2,
      kind: "team" as const,
      name: "B",
      username: null,
      available: 12,
      reserved: 0,
    },
  ];
  const output = renderToStaticMarkup(
    createElement(CreditAdmin, {
      accounts,
      dialogOpen: false,
      request: async () => ({}),
      refresh: async () => {},
      notify: noop,
      open: noop,
    }),
  );
  for (const expected of [
    "12,011.999999999999",
    "11,999.999999999999",
    "0.000000000001",
  ])
    assert.ok(output.includes(expected), expected);
  const overdraw = evaluateCreditAdjustment("12000", -1, wallet);
  assert.equal(overdraw.valid, false);
  assert.ok(overdraw.error.includes("11,999.999999999999"));
  assert.equal(overdraw.projected, "-0.000000000001");
  assert.equal(
    evaluateCreditAdjustment("1", 1, wallet).projected,
    "12000.999999999999",
  );
});

test("budget usage keeps a nearly exhausted cap distinct from its exact threshold and accepts legacy integers", async () => {
  const budgetModule = "../../apps/web/studio/SettingsBudgets.tsx";
  const { BudgetPolicyUsage } = await import(budgetModule);
  const policy = {
    id: "policy",
    scope_type: "workspace",
    scope_id: "23",
    period: "monthly",
    mode: "cap",
    enabled: true,
    spent: 100000,
    held: 0,
    total_committed: 100000,
    cap_limit: 100000,
    warn_limit: 0,
  };
  const output = renderToStaticMarkup(
    createElement(BudgetPolicyUsage, {
      policy: {
        ...policy,
        exact: {
          spent: "99999.999999999998",
          held: "0.000000000001",
          committed: "99999.999999999999",
          warn_limit: "0",
          cap_limit: "100000",
        },
      },
    }),
  );
  assert.match(output, /99,999\.999999999998/);
  assert.match(output, /0\.000000000001/);
  assert.match(output, /告警 0/);
  assert.match(
    output,
    /#10b981/,
    "no warning threshold and still below the cap",
  );
  const legacy = renderToStaticMarkup(
    createElement(BudgetPolicyUsage, { policy }),
  );
  assert.match(legacy, /100,000/);
  assert.match(legacy, /#ef4444/, "legacy amount exactly at the cap");
});
