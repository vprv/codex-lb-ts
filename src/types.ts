export type AccountStatus = "active" | "paused" | "rate_limited" | "error";
export type AccountAuthType = "api_key" | "oauth";

export interface AccountRecord {
  id: string;
  name: string;
  email: string;
  planType: string;
  baseUrl: string;
  apiKey: string;
  authType: AccountAuthType;
  refreshToken: string | null;
  idToken: string | null;
  oauthAccountId: string | null;
  lastRefreshAt: string | null;
  weight: number;
  enabled: boolean;
  status: AccountStatus;
  modelAllowlist: string[];
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RequestLogRecord {
  id: string;
  requestId: string;
  accountId: string | null;
  route: string;
  model: string | null;
  statusCode: number;
  outcome: "success" | "error";
  latencyMs: number;
  errorMessage: string | null;
  createdAt: string;
}

export interface SettingsRecord {
  stickyThreadsEnabled: boolean;
  preferEarlierResetAccounts: boolean;
  proxyApiKey: string | null;
}

export interface DashboardSummary {
  accounts: {
    total: number;
    enabled: number;
    byStatus: Record<string, number>;
  };
  requestLogs: {
    total: number;
    success: number;
    error: number;
    recent: RequestLogRecord[];
  };
}

export interface ProxyAttemptResult {
  response: Response;
  account: AccountRecord;
}
