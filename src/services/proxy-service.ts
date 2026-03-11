import { Readable } from "node:stream";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppDatabase } from "../db.js";
import type { OAuthService } from "./oauth-service.js";
import { NoEligibleAccountsError, pickAccount } from "./load-balancer.js";
import type { AccountRecord, ProxyAttemptResult } from "../types.js";

const RETRYABLE_STATUS_CODES = new Set([401, 408, 409, 429, 500, 502, 503, 504]);

export class ProxyService {
  public constructor(
    private readonly db: AppDatabase,
    private readonly oauthService: OAuthService
  ) {}

  public async listModels(): Promise<unknown> {
    const accounts = this.db.listAccounts();
    const settings = this.db.getSettings();
    const selected = pickAccount(accounts, settings, null);
    const account = await this.prepareAccount(selected);
    const response = await this.fetchFromAccount(account, "/models", { method: "GET" });

    if (!response.ok) {
      const body = await safeJson(response);
      throw new Error(`Upstream model fetch failed with ${response.status}: ${JSON.stringify(body)}`);
    }

    this.db.touchAccount(account.id);
    return safeJson(response);
  }

  public async proxyResponses(
    request: FastifyRequest<{ Body: Record<string, unknown> }>,
    reply: FastifyReply,
    upstreamPath: "/responses"
  ): Promise<void> {
    const body = request.body ?? {};
    const model = typeof body.model === "string" ? body.model : null;
    const requestId = request.id;
    const startedAt = Date.now();

    try {
      const result = await this.tryProxy(upstreamPath, request.headers, body, model);
      this.db.touchAccount(result.account.id);
      await this.sendUpstreamResponse(result, reply);
      this.db.insertRequestLog({
        id: crypto.randomUUID(),
        requestId,
        accountId: result.account.id,
        route: request.routeOptions.url ?? request.url,
        model,
        statusCode: result.response.status,
        outcome: result.response.ok ? "success" : "error",
        latencyMs: Date.now() - startedAt,
        errorMessage: result.response.ok ? null : `Upstream responded with ${result.response.status}`
      });
    } catch (error) {
      const statusCode = error instanceof NoEligibleAccountsError ? 503 : 502;
      this.db.insertRequestLog({
        id: crypto.randomUUID(),
        requestId,
        accountId: null,
        route: request.routeOptions.url ?? request.url,
        model,
        statusCode,
        outcome: "error",
        latencyMs: Date.now() - startedAt,
        errorMessage: error instanceof Error ? error.message : "Unknown proxy error"
      });
      reply.code(statusCode).send({
        error: {
          message: error instanceof Error ? error.message : "Unknown proxy error",
          type: "proxy_error"
        }
      });
    }
  }

  private async tryProxy(
    path: string,
    headers: FastifyRequest["headers"],
    body: Record<string, unknown>,
    model: string | null
  ): Promise<ProxyAttemptResult> {
    const accounts = this.db.listAccounts();
    const settings = this.db.getSettings();
    const attemptedIds = new Set<string>();
    let lastError: Error | null = null;

    while (attemptedIds.size < accounts.length) {
      const candidatePool = accounts.filter((account) => !attemptedIds.has(account.id));
      const selected = pickAccount(candidatePool, settings, model);
      const account = await this.prepareAccount(selected);
      attemptedIds.add(account.id);

      try {
        const response = await this.fetchFromAccount(account, path, {
          method: "POST",
          headers: filterRequestHeaders(headers),
          body: JSON.stringify(body)
        });

        if (response.ok || !RETRYABLE_STATUS_CODES.has(response.status)) {
          return { response, account };
        }

        lastError = new Error(`Upstream ${account.name} returned retryable status ${response.status}`);
        this.db.updateAccount(account.id, {
          status: response.status === 429 ? "rate_limited" : "error"
        });
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Unknown upstream request error");
        this.db.updateAccount(account.id, { status: "error" });
      }
    }

    throw lastError ?? new NoEligibleAccountsError();
  }

  private async fetchFromAccount(
    account: AccountRecord,
    path: string,
    init: RequestInit
  ): Promise<Response> {
    const baseUrl = account.baseUrl.endsWith("/") ? account.baseUrl.slice(0, -1) : account.baseUrl;
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${account.apiKey}`);
    if (!headers.has("content-type") && init.method !== "GET") {
      headers.set("content-type", "application/json");
    }

    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers
    });
  }

  private async prepareAccount(account: AccountRecord): Promise<AccountRecord> {
    if (account.authType !== "oauth") {
      return account;
    }
    return this.oauthService.ensureFreshOAuthAccount(account);
  }

  private async sendUpstreamResponse(result: ProxyAttemptResult, reply: FastifyReply): Promise<void> {
    const contentType = result.response.headers.get("content-type");

    reply.code(result.response.status);
    for (const [key, value] of result.response.headers.entries()) {
      if (key.toLowerCase() === "content-length") {
        continue;
      }
      reply.header(key, value);
    }
    reply.header("x-codex-lm-account-id", result.account.id);

    if (contentType?.includes("text/event-stream")) {
      if (!result.response.body) {
        reply.send("");
        return;
      }

      reply.hijack();
      const nodeStream = Readable.fromWeb(result.response.body as never);
      nodeStream.on("data", (chunk) => {
        reply.raw.write(chunk);
      });
      nodeStream.on("end", () => {
        reply.raw.end();
      });
      nodeStream.on("error", (error) => {
        reply.raw.destroy(error);
      });
      return;
    }

    reply.send(await safeJsonOrText(result.response));
  }
}

function filterRequestHeaders(headers: FastifyRequest["headers"]): HeadersInit {
  const nextHeaders = new Headers();
  for (const [key, rawValue] of Object.entries(headers)) {
    if (!rawValue) {
      continue;
    }

    const lower = key.toLowerCase();
    if (lower === "authorization" || lower === "host" || lower === "content-length") {
      continue;
    }

    nextHeaders.set(key, Array.isArray(rawValue) ? rawValue.join(", ") : rawValue);
  }

  return nextHeaders;
}

async function safeJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function safeJsonOrText(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
