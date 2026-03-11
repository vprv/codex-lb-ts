import http from "node:http";
import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import { URL, URLSearchParams } from "node:url";
import type { AppDatabase } from "../db.js";
import type { AppConfig } from "../config.js";
import type { AccountRecord } from "../types.js";

type OAuthMethod = "browser" | "device";
type OAuthStatus = "idle" | "starting" | "pending" | "success" | "error";

interface OAuthState {
  status: OAuthStatus;
  method: OAuthMethod | null;
  errorMessage: string | null;
  stateToken: string | null;
  codeVerifier: string | null;
  deviceAuthId: string | null;
  userCode: string | null;
  intervalSeconds: number | null;
  expiresAt: number | null;
  authorizationUrl: string | null;
  callbackUrl: string | null;
  verificationUrl: string | null;
  callbackServer: http.Server | null;
  pollTimer: NodeJS.Timeout | null;
}

interface OAuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  code?: string;
  message?: string;
  error?: string | { code?: string; message?: string; error?: string; error_description?: string };
  error_code?: string;
  error_description?: string;
  authorization_code?: string;
  code_verifier?: string;
}

interface DeviceCodeResponse {
  device_auth_id?: string;
  user_code?: string;
  interval?: number;
  expires_in?: number;
  expires_at?: string;
}

interface TokenClaims {
  email: string | null;
  chatgptAccountId: string | null;
  planType: string | null;
}

const DEFAULT_OAUTH_ACCOUNT_BASE_URL = "https://chatgpt.com/backend-api/codex";

export class OAuthService {
  private state: OAuthState = this.initialState();

  public constructor(
    private readonly db: AppDatabase,
    private readonly config: AppConfig
  ) {}

  public async startOAuth(forceMethod?: OAuthMethod): Promise<Record<string, unknown>> {
    const method = forceMethod ?? "browser";
    await this.reset();
    this.state.status = "starting";

    try {
      if (method === "device") {
        return await this.startDeviceFlow();
      }
      return await this.startBrowserFlow();
    } catch (error) {
      this.setError(error instanceof Error ? error.message : "OAuth start failed");
      throw error;
    }
  }

  public getStatus(): Record<string, unknown> {
    return {
      status: this.state.status === "idle" ? "pending" : this.state.status,
      errorMessage: this.state.errorMessage
    };
  }

  public async completeOAuth(payload?: { deviceAuthId?: string; userCode?: string }): Promise<Record<string, string>> {
    if (payload?.deviceAuthId) {
      this.state.deviceAuthId = payload.deviceAuthId;
    }
    if (payload?.userCode) {
      this.state.userCode = payload.userCode;
    }

    if (this.state.status === "success") {
      return { status: "success" };
    }
    if (this.state.method !== "device") {
      return { status: "pending" };
    }
    if (!this.state.deviceAuthId || !this.state.userCode) {
      this.setError("Device flow is not initialized.");
      return { status: "error" };
    }

    if (!this.state.pollTimer) {
      const intervalMs = Math.max(1000, (this.state.intervalSeconds ?? 5) * 1000);
      this.state.pollTimer = setInterval(() => {
        void this.pollDeviceToken();
      }, intervalMs);
      void this.pollDeviceToken();
    }

    return { status: "pending" };
  }

  public async manualCallback(callbackUrl: string): Promise<Record<string, string | null>> {
    const parsed = new URL(callbackUrl);
    const error = parsed.searchParams.get("error");
    const code = parsed.searchParams.get("code");
    const state = parsed.searchParams.get("state");

    if (error) {
      this.setError(`OAuth error: ${error}`);
      return { status: "error", errorMessage: this.state.errorMessage };
    }
    if (!code || !state || state !== this.state.stateToken || !this.state.codeVerifier) {
      this.setError("Invalid OAuth callback: state mismatch or missing code.");
      return { status: "error", errorMessage: this.state.errorMessage };
    }

    await this.exchangeAuthorizationCode(code, this.state.codeVerifier);
    return { status: "success", errorMessage: null };
  }

  public async ensureFreshOAuthAccount(account: AccountRecord): Promise<AccountRecord> {
    if (account.authType !== "oauth") {
      return account;
    }
    if (!account.refreshToken) {
      throw new Error(`OAuth account ${account.id} is missing a refresh token`);
    }
    if (!shouldRefresh(account.lastRefreshAt)) {
      return account;
    }

    const payload = await this.fetchJson<OAuthTokenResponse>(`${this.config.authBaseUrl}/oauth/token`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: this.config.oauthClientId,
        refresh_token: account.refreshToken,
        scope: this.config.oauthScope
      })
    });

    const accessToken = payload.access_token;
    const refreshToken = payload.refresh_token;
    const idToken = payload.id_token;
    if (!accessToken || !refreshToken || !idToken) {
      throw new Error("OAuth refresh response missing tokens");
    }

    const claims = decodeTokenClaims(idToken);
    const updated = this.db.updateAccount(account.id, {
      apiKey: accessToken,
      refreshToken,
      idToken,
      oauthAccountId: claims.chatgptAccountId,
      email: claims.email ?? account.email,
      planType: claims.planType ?? account.planType,
      lastRefreshAt: new Date().toISOString(),
      status: "active"
    });

    if (!updated) {
      throw new Error(`OAuth account ${account.id} disappeared during refresh`);
    }
    return updated;
  }

  private async startBrowserFlow(): Promise<Record<string, unknown>> {
    const codeVerifier = crypto.randomBytes(32).toString("base64url");
    const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
    const stateToken = crypto.randomBytes(16).toString("base64url");
    const authorizationUrl = new URL(`${this.config.authBaseUrl.replace(/\/$/, "")}/oauth/authorize`);
    authorizationUrl.search = new URLSearchParams({
      response_type: "code",
      client_id: this.config.oauthClientId,
      redirect_uri: this.config.oauthRedirectUri,
      scope: ensureOfflineAccess(this.config.oauthScope),
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state: stateToken,
      id_token_add_organizations: "true",
      codex_cli_simplified_flow: "true",
      originator: "codex_cli_rs"
    }).toString();

    this.state = {
      ...this.initialState(),
      status: "pending",
      method: "browser",
      stateToken,
      codeVerifier,
      authorizationUrl: authorizationUrl.toString(),
      callbackUrl: this.config.oauthRedirectUri
    };

    await this.startCallbackServer();

    return {
      method: "browser",
      authorizationUrl: this.state.authorizationUrl,
      callbackUrl: this.state.callbackUrl,
      verificationUrl: null,
      userCode: null,
      deviceAuthId: null,
      intervalSeconds: null,
      expiresInSeconds: null
    };
  }

  private async startDeviceFlow(): Promise<Record<string, unknown>> {
    const payload = await this.fetchJson<DeviceCodeResponse>(`${this.config.authBaseUrl}/api/accounts/deviceauth/usercode`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        client_id: this.config.oauthClientId
      })
    });

    if (!payload.device_auth_id || !payload.user_code) {
      throw new Error("Device auth response missing fields");
    }

    const expiresInSeconds = payload.expires_in ?? computeExpiresInSeconds(payload.expires_at) ?? 900;
    this.state = {
      ...this.initialState(),
      status: "pending",
      method: "device",
      deviceAuthId: payload.device_auth_id,
      userCode: payload.user_code,
      intervalSeconds: payload.interval ?? 5,
      expiresAt: Date.now() + expiresInSeconds * 1000,
      verificationUrl: `${this.config.authBaseUrl.replace(/\/$/, "")}/codex/device`
    };

    return {
      method: "device",
      authorizationUrl: null,
      callbackUrl: null,
      verificationUrl: this.state.verificationUrl,
      userCode: this.state.userCode,
      deviceAuthId: this.state.deviceAuthId,
      intervalSeconds: this.state.intervalSeconds,
      expiresInSeconds
    };
  }

  private async startCallbackServer(): Promise<void> {
    const callbackServer = http.createServer((req, res) => {
      void this.handleCallbackRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      callbackServer.once("error", reject);
      callbackServer.listen(this.config.oauthCallbackPort, this.config.oauthCallbackHost, () => {
        callbackServer.off("error", reject);
        resolve();
      });
    });

    this.state.callbackServer = callbackServer;
  }

  private async handleCallbackRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", this.config.oauthRedirectUri);
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      if (error) {
        this.setError(`OAuth error: ${error}`);
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        res.end("<h1>Authorization failed</h1><p>You can close this window.</p>");
        return;
      }

      if (!code || !state || state !== this.state.stateToken || !this.state.codeVerifier) {
        this.setError("Invalid OAuth callback.");
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        res.end("<h1>Invalid callback</h1><p>You can close this window.</p>");
        return;
      }

      await this.exchangeAuthorizationCode(code, this.state.codeVerifier);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<h1>Account added</h1><p>You can close this window.</p>");
    } catch (error) {
      this.setError(error instanceof Error ? error.message : "OAuth callback failed");
      res.writeHead(500, { "content-type": "text/html; charset=utf-8" });
      res.end("<h1>Authorization failed</h1><p>You can close this window.</p>");
    } finally {
      await this.stopCallbackServer();
    }
  }

  private async exchangeAuthorizationCode(code: string, codeVerifier: string): Promise<void> {
    const payload = await this.fetchForm<OAuthTokenResponse>(`${this.config.authBaseUrl}/oauth/token`, new URLSearchParams({
      grant_type: "authorization_code",
      client_id: this.config.oauthClientId,
      code,
      code_verifier: codeVerifier,
      redirect_uri: this.config.oauthRedirectUri
    }));

    const accessToken = payload.access_token;
    const refreshToken = payload.refresh_token;
    const idToken = payload.id_token;
    if (!accessToken || !refreshToken || !idToken) {
      throw new Error("OAuth authorization response missing tokens");
    }

    this.persistOAuthAccount({
      accessToken,
      refreshToken,
      idToken
    });
  }

  private async pollDeviceToken(): Promise<void> {
    if (!this.state.deviceAuthId || !this.state.userCode) {
      this.setError("Device code flow is not initialized.");
      return;
    }
    if (this.state.expiresAt && Date.now() > this.state.expiresAt) {
      this.setError("Device code expired.");
      return;
    }

    try {
      const payload = await this.fetchJson<OAuthTokenResponse>(`${this.config.authBaseUrl}/api/accounts/deviceauth/token`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          device_auth_id: this.state.deviceAuthId,
          user_code: this.state.userCode
        })
      }, false);

      const errorCode = extractOAuthErrorCode(payload);
      if (errorCode === "authorization_pending" || errorCode === "slow_down") {
        return;
      }

      if (payload.authorization_code && payload.code_verifier) {
        await this.exchangeAuthorizationCode(payload.authorization_code, payload.code_verifier);
        return;
      }

      if (payload.access_token && payload.refresh_token && payload.id_token) {
        this.persistOAuthAccount({
          accessToken: payload.access_token,
          refreshToken: payload.refresh_token,
          idToken: payload.id_token
        });
        return;
      }

      if (errorCode) {
        this.setError(extractOAuthMessage(payload) ?? errorCode);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Device auth polling failed";
      if (!message.includes("403") && !message.includes("404")) {
        this.setError(message);
      }
    }
  }

  private persistOAuthAccount(tokens: { accessToken: string; refreshToken: string; idToken: string }): void {
    const claims = decodeTokenClaims(tokens.idToken);
    const id = claims.chatgptAccountId || crypto.randomUUID();
    const existing = this.db.getAccount(id);
    const payload: AccountRecord = {
      id,
      name: claims.email ?? "OpenAI OAuth Account",
      email: claims.email ?? "unknown@openai.local",
      planType: claims.planType ?? "chatgpt",
      baseUrl: DEFAULT_OAUTH_ACCOUNT_BASE_URL,
      apiKey: tokens.accessToken,
      authType: "oauth",
      refreshToken: tokens.refreshToken,
      idToken: tokens.idToken,
      oauthAccountId: claims.chatgptAccountId,
      lastRefreshAt: new Date().toISOString(),
      weight: existing?.weight ?? 1,
      enabled: existing?.enabled ?? true,
      status: "active",
      modelAllowlist: existing?.modelAllowlist ?? [],
      lastUsedAt: existing?.lastUsedAt ?? null,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (existing) {
      this.db.updateAccount(id, payload);
    } else {
      this.db.insertAccount(payload);
    }
    this.state.status = "success";
    this.state.errorMessage = null;
    this.clearPollTimer();
  }

  private async fetchForm<T>(url: string, body: URLSearchParams): Promise<T> {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body: body.toString()
    });
    const payload = await safeJson<T>(response);
    if (!response.ok) {
      throw new Error(extractOAuthMessage(payload) ?? `OAuth request failed (${response.status})`);
    }
    return payload;
  }

  private async fetchJson<T>(url: string, init: RequestInit, throwOnHttpError = true): Promise<T> {
    const response = await fetch(url, init);
    const payload = await safeJson<T>(response);
    if (throwOnHttpError && !response.ok) {
      throw new Error(extractOAuthMessage(payload) ?? `OAuth request failed (${response.status})`);
    }
    return payload;
  }

  private setError(message: string): void {
    this.state.status = "error";
    this.state.errorMessage = message;
    this.clearPollTimer();
  }

  private clearPollTimer(): void {
    if (this.state.pollTimer) {
      clearInterval(this.state.pollTimer);
      this.state.pollTimer = null;
    }
  }

  private async stopCallbackServer(): Promise<void> {
    const server = this.state.callbackServer;
    if (!server) {
      return;
    }
    this.state.callbackServer = null;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private async reset(): Promise<void> {
    this.clearPollTimer();
    await this.stopCallbackServer();
    this.state = this.initialState();
  }

  private initialState(): OAuthState {
    return {
      status: "idle",
      method: null,
      errorMessage: null,
      stateToken: null,
      codeVerifier: null,
      deviceAuthId: null,
      userCode: null,
      intervalSeconds: null,
      expiresAt: null,
      authorizationUrl: null,
      callbackUrl: null,
      verificationUrl: null,
      callbackServer: null,
      pollTimer: null
    };
  }
}

function decodeTokenClaims(idToken: string): TokenClaims {
  const parts = idToken.split(".");
  if (parts.length < 2) {
    return { email: null, chatgptAccountId: null, planType: null };
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
    const auth = isObject(payload.auth) ? payload.auth : null;
    return {
      email: typeof payload.email === "string" ? payload.email : null,
      chatgptAccountId:
        (auth && typeof auth.chatgpt_account_id === "string" ? auth.chatgpt_account_id : null) ??
        (typeof payload.chatgpt_account_id === "string" ? payload.chatgpt_account_id : null),
      planType:
        (auth && typeof auth.chatgpt_plan_type === "string" ? auth.chatgpt_plan_type : null) ??
        (typeof payload.chatgpt_plan_type === "string" ? payload.chatgpt_plan_type : null)
    };
  } catch {
    return { email: null, chatgptAccountId: null, planType: null };
  }
}

function ensureOfflineAccess(scope: string): string {
  return scope.includes("offline_access") ? scope : `${scope} offline_access`;
}

function computeExpiresInSeconds(expiresAt: string | undefined): number | null {
  if (!expiresAt) {
    return null;
  }
  const timestamp = Date.parse(expiresAt);
  if (Number.isNaN(timestamp)) {
    return null;
  }
  return Math.max(0, Math.round((timestamp - Date.now()) / 1000));
}

function shouldRefresh(lastRefreshAt: string | null): boolean {
  if (!lastRefreshAt) {
    return true;
  }
  const timestamp = Date.parse(lastRefreshAt);
  if (Number.isNaN(timestamp)) {
    return true;
  }
  const eightDaysMs = 8 * 24 * 60 * 60 * 1000;
  return Date.now() - timestamp > eightDaysMs;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function safeJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    return {} as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return { message: text } as T;
  }
}

function extractOAuthErrorCode(payload: unknown): string | null {
  if (!isObject(payload)) {
    return null;
  }
  const error = payload.error;
  if (typeof error === "string") {
    return error;
  }
  if (isObject(error)) {
    const code = error.code ?? error.error;
    return typeof code === "string" ? code : null;
  }
  return typeof payload.error_code === "string" ? payload.error_code : typeof payload.code === "string" ? payload.code : null;
}

function extractOAuthMessage(payload: unknown): string | null {
  if (!isObject(payload)) {
    return null;
  }
  const error = payload.error;
  if (typeof error === "string") {
    return typeof payload.error_description === "string" ? payload.error_description : error;
  }
  if (isObject(error)) {
    const message = error.message ?? error.error_description;
    return typeof message === "string" ? message : null;
  }
  return typeof payload.message === "string" ? payload.message : null;
}
