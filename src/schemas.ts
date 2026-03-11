import { z } from "zod";

export const accountCreateSchema = z.object({
  name: z.string().min(1),
  email: z.email(),
  planType: z.string().min(1).default("custom"),
  baseUrl: z.url(),
  apiKey: z.string().min(1),
  authType: z.enum(["api_key", "oauth"]).default("api_key"),
  refreshToken: z.string().min(1).nullable().optional(),
  idToken: z.string().min(1).nullable().optional(),
  oauthAccountId: z.string().min(1).nullable().optional(),
  lastRefreshAt: z.iso.datetime().nullable().optional(),
  weight: z.number().int().positive().default(1),
  enabled: z.boolean().default(true),
  modelAllowlist: z.array(z.string().min(1)).default([])
});

export const accountPatchSchema = accountCreateSchema.partial().extend({
  status: z.enum(["active", "paused", "rate_limited", "error"]).optional()
});

export const settingsSchema = z.object({
  stickyThreadsEnabled: z.boolean(),
  preferEarlierResetAccounts: z.boolean(),
  proxyApiKey: z.string().min(1).nullable()
});

export const oauthStartSchema = z.object({
  forceMethod: z.enum(["browser", "device"]).optional()
});

export const oauthCompleteSchema = z.object({
  deviceAuthId: z.string().optional(),
  userCode: z.string().optional()
}).optional();

export const oauthManualCallbackSchema = z.object({
  callbackUrl: z.url()
});

export const responsesRequestSchema = z.object({
  model: z.string().min(1),
  stream: z.boolean().optional()
}).passthrough();

export type AccountCreateInput = z.infer<typeof accountCreateSchema>;
export type AccountPatchInput = z.infer<typeof accountPatchSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
