import Fastify from "fastify";
import cors from "@fastify/cors";
import type { AppConfig } from "./config.js";
import { AppDatabase } from "./db.js";
import {
  accountCreateSchema,
  accountPatchSchema,
  oauthCompleteSchema,
  oauthManualCallbackSchema,
  oauthStartSchema,
  responsesRequestSchema,
  settingsSchema
} from "./schemas.js";
import { ProxyService } from "./services/proxy-service.js";
import { OAuthService } from "./services/oauth-service.js";

export function buildApp(config: AppConfig) {
  const db = new AppDatabase(config.dbPath);
  const oauthService = new OAuthService(db, config);
  const proxyService = new ProxyService(db, oauthService);
  const app = Fastify({
    logger: true,
    bodyLimit: 50 * 1024 * 1024 // 50 MB - allow images (base64) via /v1/responses
  });

  // #region agent log
  app.addHook("onRequest", async (request) => {
    fetch('http://127.0.0.1:7277/ingest/0281294a-ee27-481e-845d-e430a58d489a',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'0e9738'},body:JSON.stringify({sessionId:'0e9738',location:'src/app.ts:onRequest',message:'Request received',data:{url:request.url,method:request.method,contentLength:request.headers['content-length']},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
  });
  // #endregion

  app.register(cors, { origin: true });

  app.addHook("preHandler", async (request, reply) => {
    if (
      request.url.startsWith("/v1") ||
      request.url.startsWith("/backend-api/codex")
    ) {
      const settings = db.getSettings();
      if (!settings.proxyApiKey) {
        return;
      }

      const authHeader = request.headers.authorization;
      const expected = `Bearer ${settings.proxyApiKey}`;
      if (authHeader !== expected) {
        return reply.code(401).send({
          error: {
            message: "Invalid proxy API key",
            type: "invalid_api_key"
          }
        });
      }
    }
  });

  app.get("/", async () => ({
    name: "codex-lm-ts",
    version: "0.1.0"
  }));

  app.get("/health", async () => ({
    status: "ok"
  }));

  app.get("/api/accounts", async () => db.listAccounts());

  app.post("/api/accounts", async (request, reply) => {
    const input = accountCreateSchema.parse(request.body);
    const account = db.insertAccount({
      id: crypto.randomUUID(),
      name: input.name,
      email: input.email,
      planType: input.planType,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      authType: input.authType,
      refreshToken: input.refreshToken ?? null,
      idToken: input.idToken ?? null,
      oauthAccountId: input.oauthAccountId ?? null,
      lastRefreshAt: input.lastRefreshAt ?? null,
      weight: input.weight,
      enabled: input.enabled,
      modelAllowlist: input.modelAllowlist
    });
    reply.code(201).send(account);
  });

  app.patch<{ Params: { id: string } }>("/api/accounts/:id", async (request, reply) => {
    const input = accountPatchSchema.parse(request.body);
    const updated = db.updateAccount(request.params.id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.planType !== undefined ? { planType: input.planType } : {}),
      ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
      ...(input.apiKey !== undefined ? { apiKey: input.apiKey } : {}),
      ...(input.authType !== undefined ? { authType: input.authType } : {}),
      ...(input.refreshToken !== undefined ? { refreshToken: input.refreshToken } : {}),
      ...(input.idToken !== undefined ? { idToken: input.idToken } : {}),
      ...(input.oauthAccountId !== undefined ? { oauthAccountId: input.oauthAccountId } : {}),
      ...(input.lastRefreshAt !== undefined ? { lastRefreshAt: input.lastRefreshAt } : {}),
      ...(input.weight !== undefined ? { weight: input.weight } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.modelAllowlist !== undefined ? { modelAllowlist: input.modelAllowlist } : {}),
      ...(input.status !== undefined ? { status: input.status } : {})
    });

    if (!updated) {
      reply.code(404).send({ message: "Account not found" });
      return;
    }

    reply.send(updated);
  });

  app.get("/api/settings", async () => db.getSettings());

  app.put("/api/settings", async (request) => {
    const input = settingsSchema.parse(request.body);
    return db.updateSettings(input);
  });

  app.get("/api/dashboard/summary", async () => db.getDashboardSummary());
  app.get("/api/request-logs", async () => db.listRequestLogs());
  app.post("/api/oauth/start", async (request) => {
    const input = oauthStartSchema.parse(request.body);
    return oauthService.startOAuth(input.forceMethod);
  });
  app.get("/api/oauth/status", async () => oauthService.getStatus());
  app.post("/api/oauth/complete", async (request) => {
    const input = oauthCompleteSchema.parse(request.body);
    return oauthService.completeOAuth(input ? {
      ...(input.deviceAuthId !== undefined ? { deviceAuthId: input.deviceAuthId } : {}),
      ...(input.userCode !== undefined ? { userCode: input.userCode } : {})
    } : undefined);
  });
  app.post("/api/oauth/manual-callback", async (request) => {
    const input = oauthManualCallbackSchema.parse(request.body);
    return oauthService.manualCallback(input.callbackUrl);
  });

  app.get("/v1/models", async () => proxyService.listModels());
  app.get("/backend-api/codex/models", async () => proxyService.listModels());

  app.post<{ Body: Record<string, unknown> }>("/v1/chat/completions", async (request, reply) => {
    await proxyService.proxyChatCompletions(request, reply);
  });

  app.post<{ Body: Record<string, unknown> }>("/v1/responses", async (request, reply) => {
    responsesRequestSchema.parse(request.body);
    await proxyService.proxyResponses(request, reply, "/responses");
  });

  app.post<{ Body: Record<string, unknown> }>("/backend-api/codex/responses", async (request, reply) => {
    responsesRequestSchema.parse(request.body);
    await proxyService.proxyResponses(request, reply, "/responses");
  });

  return app;
}
