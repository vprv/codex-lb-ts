import { get, put } from "@/lib/api-client";
import { z } from "zod";

const SettingsSchema = z.object({
  stickyThreadsEnabled: z.boolean(),
  preferEarlierResetAccounts: z.boolean(),
  proxyApiKey: z.string().nullable(),
});

export type AppSettings = z.infer<typeof SettingsSchema>;

export function getSettings() {
  return get("/api/settings", SettingsSchema);
}

export function updateSettings(payload: AppSettings) {
  return put("/api/settings", SettingsSchema, {
    body: SettingsSchema.parse(payload),
  });
}
