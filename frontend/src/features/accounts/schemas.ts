import { z } from "zod";

export const OAuthStateSchema = z.object({
  status: z.enum(["idle", "starting", "pending", "success", "error"]),
  method: z.enum(["browser", "device"]).nullable(),
  authorizationUrl: z.string().nullable(),
  callbackUrl: z.string().nullable(),
  verificationUrl: z.string().nullable(),
  userCode: z.string().nullable(),
  deviceAuthId: z.string().nullable(),
  intervalSeconds: z.number().nullable(),
  expiresInSeconds: z.number().nullable(),
  errorMessage: z.string().nullable(),
});

export type OAuthState = z.infer<typeof OAuthStateSchema>;
