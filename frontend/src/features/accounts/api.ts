import { get, patch, post } from "@/lib/api-client";
import { z } from "zod";

const AccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  planType: z.string(),
  baseUrl: z.string(),
  apiKey: z.string(),
  weight: z.number(),
  enabled: z.boolean(),
  status: z.enum(["active", "paused", "rate_limited", "error"]),
  modelAllowlist: z.array(z.string()),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const AccountCreateSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  planType: z.string().min(1),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  authType: z.enum(["api_key", "oauth"]).optional(),
  weight: z.number().int().positive(),
  enabled: z.boolean(),
  modelAllowlist: z.array(z.string()),
});

const AccountPatchSchema = AccountCreateSchema.partial().extend({
  status: z.enum(["active", "paused", "rate_limited", "error"]).optional(),
});

export type Account = z.infer<typeof AccountSchema>;
export type CreateAccountInput = z.infer<typeof AccountCreateSchema>;
export type PatchAccountInput = z.infer<typeof AccountPatchSchema>;

export function listAccounts() {
  return get("/api/accounts", z.array(AccountSchema));
}

export function createAccount(payload: CreateAccountInput) {
  return post("/api/accounts", AccountSchema, {
    body: AccountCreateSchema.parse(payload),
  });
}

export function updateAccount(accountId: string, payload: PatchAccountInput) {
  return patch(`/api/accounts/${encodeURIComponent(accountId)}`, AccountSchema, {
    body: AccountPatchSchema.parse(payload),
  });
}

const OAuthStartResponseSchema = z.object({
  method: z.enum(["browser", "device"]),
  authorizationUrl: z.string().nullable(),
  callbackUrl: z.string().nullable(),
  verificationUrl: z.string().nullable(),
  userCode: z.string().nullable(),
  deviceAuthId: z.string().nullable(),
  intervalSeconds: z.number().nullable(),
  expiresInSeconds: z.number().nullable(),
});

const OAuthStatusResponseSchema = z.object({
  status: z.enum(["pending", "success", "error"]),
  errorMessage: z.string().nullable(),
});

const OAuthCompleteResponseSchema = z.object({
  status: z.string(),
});

const ManualOauthCallbackResponseSchema = z.object({
  status: z.string(),
  errorMessage: z.string().nullable(),
});

export function startOauth(payload: { forceMethod?: "browser" | "device" }) {
  return post("/api/oauth/start", OAuthStartResponseSchema, {
    body: payload,
  });
}

export function getOauthStatus() {
  return get("/api/oauth/status", OAuthStatusResponseSchema);
}

export function completeOauth(payload?: { deviceAuthId?: string; userCode?: string }) {
  return post("/api/oauth/complete", OAuthCompleteResponseSchema, {
    body: payload ?? {},
  });
}

export function submitManualOauthCallback(payload: { callbackUrl: string }) {
  return post("/api/oauth/manual-callback", ManualOauthCallbackResponseSchema, {
    body: payload,
  });
}
