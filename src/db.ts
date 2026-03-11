import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { AccountRecord, DashboardSummary, RequestLogRecord, SettingsRecord } from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function parseJsonArray(value: string | null): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

export class AppDatabase {
  private readonly db: Database.Database;

  public constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        plan_type TEXT NOT NULL,
        base_url TEXT NOT NULL,
        api_key TEXT NOT NULL,
        auth_type TEXT NOT NULL DEFAULT 'api_key',
        refresh_token TEXT,
        id_token TEXT,
        oauth_account_id TEXT,
        last_refresh_at TEXT,
        weight INTEGER NOT NULL DEFAULT 1,
        enabled INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'active',
        model_allowlist TEXT,
        last_used_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        sticky_threads_enabled INTEGER NOT NULL DEFAULT 0,
        prefer_earlier_reset_accounts INTEGER NOT NULL DEFAULT 0,
        proxy_api_key TEXT
      );

      CREATE TABLE IF NOT EXISTS request_logs (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        account_id TEXT,
        route TEXT NOT NULL,
        model TEXT,
        status_code INTEGER NOT NULL,
        outcome TEXT NOT NULL,
        latency_ms INTEGER NOT NULL,
        error_message TEXT,
        created_at TEXT NOT NULL
      );

      INSERT INTO settings (id, sticky_threads_enabled, prefer_earlier_reset_accounts, proxy_api_key)
      VALUES (1, 0, 0, NULL)
      ON CONFLICT(id) DO NOTHING;
    `);

    this.ensureColumn("accounts", "auth_type", "TEXT NOT NULL DEFAULT 'api_key'");
    this.ensureColumn("accounts", "refresh_token", "TEXT");
    this.ensureColumn("accounts", "id_token", "TEXT");
    this.ensureColumn("accounts", "oauth_account_id", "TEXT");
    this.ensureColumn("accounts", "last_refresh_at", "TEXT");
  }

  private ensureColumn(tableName: string, columnName: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === columnName)) {
      return;
    }
    this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }

  public listAccounts(): AccountRecord[] {
    const rows = this.db.prepare(`
      SELECT
        id,
        name,
        email,
        plan_type,
        base_url,
        api_key,
        auth_type,
        refresh_token,
        id_token,
        oauth_account_id,
        last_refresh_at,
        weight,
        enabled,
        status,
        model_allowlist,
        last_used_at,
        created_at,
        updated_at
      FROM accounts
      ORDER BY created_at ASC
    `).all() as Array<Record<string, unknown>>;

    return rows.map((row) => this.mapAccount(row));
  }

  public getAccount(id: string): AccountRecord | null {
    const row = this.db.prepare(`
      SELECT
        id,
        name,
        email,
        plan_type,
        base_url,
        api_key,
        auth_type,
        refresh_token,
        id_token,
        oauth_account_id,
        last_refresh_at,
        weight,
        enabled,
        status,
        model_allowlist,
        last_used_at,
        created_at,
        updated_at
      FROM accounts
      WHERE id = ?
    `).get(id) as Record<string, unknown> | undefined;

    return row ? this.mapAccount(row) : null;
  }

  public insertAccount(account: Omit<AccountRecord, "createdAt" | "updatedAt" | "lastUsedAt" | "status"> & {
    status?: AccountRecord["status"];
    lastUsedAt?: string | null;
  }): AccountRecord {
    const createdAt = nowIso();
    const updatedAt = createdAt;
    this.db.prepare(`
      INSERT INTO accounts (
        id, name, email, plan_type, base_url, api_key, auth_type, refresh_token, id_token, oauth_account_id, last_refresh_at, weight, enabled, status, model_allowlist, last_used_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      account.id,
      account.name,
      account.email,
      account.planType,
      account.baseUrl,
      account.apiKey,
      account.authType,
      account.refreshToken,
      account.idToken,
      account.oauthAccountId,
      account.lastRefreshAt,
      account.weight,
      account.enabled ? 1 : 0,
      account.status ?? "active",
      JSON.stringify(account.modelAllowlist),
      account.lastUsedAt ?? null,
      createdAt,
      updatedAt
    );

    return this.getAccount(account.id)!;
  }

  public updateAccount(id: string, updates: Partial<AccountRecord>): AccountRecord | null {
    const current = this.getAccount(id);
    if (!current) {
      return null;
    }

    const next = {
      ...current,
      ...updates,
      updatedAt: nowIso()
    };

    this.db.prepare(`
      UPDATE accounts
      SET
        name = ?,
        email = ?,
        plan_type = ?,
        base_url = ?,
        api_key = ?,
        auth_type = ?,
        refresh_token = ?,
        id_token = ?,
        oauth_account_id = ?,
        last_refresh_at = ?,
        weight = ?,
        enabled = ?,
        status = ?,
        model_allowlist = ?,
        last_used_at = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      next.name,
      next.email,
      next.planType,
      next.baseUrl,
      next.apiKey,
      next.authType,
      next.refreshToken,
      next.idToken,
      next.oauthAccountId,
      next.lastRefreshAt,
      next.weight,
      next.enabled ? 1 : 0,
      next.status,
      JSON.stringify(next.modelAllowlist),
      next.lastUsedAt,
      next.updatedAt,
      id
    );

    return this.getAccount(id);
  }

  public touchAccount(id: string): void {
    this.db.prepare(`
      UPDATE accounts
      SET last_used_at = ?, updated_at = ?
      WHERE id = ?
    `).run(nowIso(), nowIso(), id);
  }

  public getSettings(): SettingsRecord {
    const row = this.db.prepare(`
      SELECT sticky_threads_enabled, prefer_earlier_reset_accounts, proxy_api_key
      FROM settings
      WHERE id = 1
    `).get() as Record<string, unknown>;

    return {
      stickyThreadsEnabled: Boolean(row.sticky_threads_enabled),
      preferEarlierResetAccounts: Boolean(row.prefer_earlier_reset_accounts),
      proxyApiKey: typeof row.proxy_api_key === "string" ? row.proxy_api_key : null
    };
  }

  public updateSettings(settings: SettingsRecord): SettingsRecord {
    this.db.prepare(`
      UPDATE settings
      SET
        sticky_threads_enabled = ?,
        prefer_earlier_reset_accounts = ?,
        proxy_api_key = ?
      WHERE id = 1
    `).run(
      settings.stickyThreadsEnabled ? 1 : 0,
      settings.preferEarlierResetAccounts ? 1 : 0,
      settings.proxyApiKey
    );

    return this.getSettings();
  }

  public insertRequestLog(log: Omit<RequestLogRecord, "createdAt"> & { createdAt?: string }): RequestLogRecord {
    const createdAt = log.createdAt ?? nowIso();
    this.db.prepare(`
      INSERT INTO request_logs (
        id, request_id, account_id, route, model, status_code, outcome, latency_ms, error_message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      log.id,
      log.requestId,
      log.accountId,
      log.route,
      log.model,
      log.statusCode,
      log.outcome,
      log.latencyMs,
      log.errorMessage,
      createdAt
    );

    return {
      ...log,
      createdAt
    };
  }

  public listRequestLogs(limit = 50): RequestLogRecord[] {
    const rows = this.db.prepare(`
      SELECT id, request_id, account_id, route, model, status_code, outcome, latency_ms, error_message, created_at
      FROM request_logs
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: String(row.id),
      requestId: String(row.request_id),
      accountId: row.account_id === null ? null : String(row.account_id),
      route: String(row.route),
      model: row.model === null ? null : String(row.model),
      statusCode: Number(row.status_code),
      outcome: row.outcome === "success" ? "success" : "error",
      latencyMs: Number(row.latency_ms),
      errorMessage: row.error_message === null ? null : String(row.error_message),
      createdAt: String(row.created_at)
    }));
  }

  public getDashboardSummary(): DashboardSummary {
    const accounts = this.listAccounts();
    const recent = this.listRequestLogs(20);
    const totals = this.db.prepare(`
      SELECT outcome, COUNT(*) as count
      FROM request_logs
      GROUP BY outcome
    `).all() as Array<{ outcome: string; count: number }>;

    return {
      accounts: {
        total: accounts.length,
        enabled: accounts.filter((account) => account.enabled).length,
        byStatus: accounts.reduce<Record<string, number>>((acc, account) => {
          acc[account.status] = (acc[account.status] ?? 0) + 1;
          return acc;
        }, {})
      },
      requestLogs: {
        total: totals.reduce((sum, row) => sum + Number(row.count), 0),
        success: Number(totals.find((row) => row.outcome === "success")?.count ?? 0),
        error: Number(totals.find((row) => row.outcome === "error")?.count ?? 0),
        recent
      }
    };
  }

  private mapAccount(row: Record<string, unknown>): AccountRecord {
    return {
      id: String(row.id),
      name: String(row.name),
      email: String(row.email),
      planType: String(row.plan_type),
      baseUrl: String(row.base_url),
      apiKey: String(row.api_key),
      authType: row.auth_type === "oauth" ? "oauth" : "api_key",
      refreshToken: row.refresh_token === null ? null : String(row.refresh_token),
      idToken: row.id_token === null ? null : String(row.id_token),
      oauthAccountId: row.oauth_account_id === null ? null : String(row.oauth_account_id),
      lastRefreshAt: row.last_refresh_at === null ? null : String(row.last_refresh_at),
      weight: Number(row.weight),
      enabled: Boolean(row.enabled),
      status: this.normalizeStatus(row.status),
      modelAllowlist: parseJsonArray(typeof row.model_allowlist === "string" ? row.model_allowlist : null),
      lastUsedAt: row.last_used_at === null ? null : String(row.last_used_at),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private normalizeStatus(value: unknown): AccountRecord["status"] {
    if (value === "paused" || value === "rate_limited" || value === "error") {
      return value;
    }
    return "active";
  }
}
