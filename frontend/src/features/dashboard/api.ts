import { get } from "@/lib/api-client";
import { z } from "zod";

const DashboardSummarySchema = z.object({
  accounts: z.object({
    total: z.number(),
    enabled: z.number(),
    byStatus: z.record(z.string(), z.number()),
  }),
  requestLogs: z.object({
    total: z.number(),
    success: z.number(),
    error: z.number(),
    recent: z.array(
      z.object({
        id: z.string(),
        requestId: z.string(),
        accountId: z.string().nullable(),
        route: z.string(),
        model: z.string().nullable(),
        statusCode: z.number(),
        outcome: z.enum(["success", "error"]),
        latencyMs: z.number(),
        errorMessage: z.string().nullable(),
        createdAt: z.string(),
      }),
    ),
  }),
});

const HealthSchema = z.object({
  status: z.string(),
});

export type DashboardSummary = z.infer<typeof DashboardSummarySchema>;

export function getDashboardSummary() {
  return get("/api/dashboard/summary", DashboardSummarySchema);
}

export function getHealth() {
  return get("/health", HealthSchema);
}
