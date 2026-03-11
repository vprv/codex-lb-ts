import test from "node:test";
import assert from "node:assert/strict";
import { pickAccount } from "../src/services/load-balancer.js";
import type { AccountRecord, SettingsRecord } from "../src/types.js";

function buildAccount(overrides: Partial<AccountRecord>): AccountRecord {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: overrides.name ?? "acct",
    email: overrides.email ?? "ops@example.com",
    planType: overrides.planType ?? "custom",
    baseUrl: overrides.baseUrl ?? "https://api.example.com/v1",
    apiKey: overrides.apiKey ?? "sk-test",
    authType: overrides.authType ?? "api_key",
    refreshToken: overrides.refreshToken ?? null,
    idToken: overrides.idToken ?? null,
    oauthAccountId: overrides.oauthAccountId ?? null,
    lastRefreshAt: overrides.lastRefreshAt ?? null,
    weight: overrides.weight ?? 1,
    enabled: overrides.enabled ?? true,
    status: overrides.status ?? "active",
    modelAllowlist: overrides.modelAllowlist ?? [],
    lastUsedAt: overrides.lastUsedAt ?? null,
    createdAt: overrides.createdAt ?? "2026-03-10T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-03-10T00:00:00.000Z"
  };
}

const settings: SettingsRecord = {
  stickyThreadsEnabled: false,
  preferEarlierResetAccounts: false,
  proxyApiKey: null
};

test("pickAccount prefers higher weight when all are otherwise eligible", () => {
  const chosen = pickAccount([
    buildAccount({ id: "low", weight: 1 }),
    buildAccount({ id: "high", weight: 5 })
  ], settings, null);

  assert.equal(chosen.id, "high");
});

test("pickAccount filters out disabled and mismatched-model accounts", () => {
  const chosen = pickAccount([
    buildAccount({ id: "disabled", enabled: false }),
    buildAccount({ id: "wrong-model", modelAllowlist: ["gpt-4.1"] }),
    buildAccount({ id: "correct", modelAllowlist: ["gpt-5.3-codex"] })
  ], settings, "gpt-5.3-codex");

  assert.equal(chosen.id, "correct");
});
