import type { AccountRecord, SettingsRecord } from "../types.js";

export class NoEligibleAccountsError extends Error {
  public constructor(message = "No eligible accounts available") {
    super(message);
  }
}

export function pickAccount(
  accounts: AccountRecord[],
  settings: SettingsRecord,
  model: string | null
): AccountRecord {
  const eligible = accounts.filter((account) => {
    if (!account.enabled || account.status !== "active") {
      return false;
    }

    if (model && account.modelAllowlist.length > 0 && !account.modelAllowlist.includes(model)) {
      return false;
    }

    return true;
  });

  if (eligible.length === 0) {
    throw new NoEligibleAccountsError();
  }

  const sorted = [...eligible].sort((left, right) => {
    if (settings.preferEarlierResetAccounts) {
      const leftUsed = left.lastUsedAt ?? "";
      const rightUsed = right.lastUsedAt ?? "";
      return leftUsed.localeCompare(rightUsed) || right.weight - left.weight;
    }

    return score(right) - score(left) || lastUsed(left).localeCompare(lastUsed(right));
  });

  return sorted[0]!;
}

function score(account: AccountRecord): number {
  return Math.max(1, account.weight);
}

function lastUsed(account: AccountRecord): string {
  return account.lastUsedAt ?? "";
}
