import { useQuery } from "@tanstack/react-query";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDashboardSummary } from "@/features/dashboard/api";

export function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", "summary"],
    queryFn: getDashboardSummary,
    refetchInterval: 15_000,
  });

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading dashboard…</div>;
  }

  if (!data) {
    return <div className="text-sm text-muted-foreground">No dashboard data available.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Overview of active accounts and recent proxy traffic.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="Accounts" value={String(data.accounts.total)} description="Total configured upstream accounts" />
        <SummaryCard title="Enabled" value={String(data.accounts.enabled)} description="Accounts currently eligible for routing" />
        <SummaryCard title="Requests" value={String(data.requestLogs.total)} description="All logged proxy requests" />
        <SummaryCard
          title="Success Rate"
          value={formatPercent(data.requestLogs.success, data.requestLogs.total)}
          description={`${data.requestLogs.success} success / ${data.requestLogs.error} error`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <Card className="card-hover">
          <CardHeader>
            <CardTitle>Recent Requests</CardTitle>
            <CardDescription>Latest proxied requests recorded by the backend</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-4 font-medium">Time</th>
                  <th className="py-2 pr-4 font-medium">Route</th>
                  <th className="py-2 pr-4 font-medium">Model</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 font-medium">Latency</th>
                </tr>
              </thead>
              <tbody>
                {data.requestLogs.recent.map((entry) => (
                  <tr key={entry.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-4 text-muted-foreground">{formatDateTime(entry.createdAt)}</td>
                    <td className="py-2 pr-4">{entry.route}</td>
                    <td className="py-2 pr-4">{entry.model ?? "—"}</td>
                    <td className="py-2 pr-4">
                      <span className={entry.outcome === "success" ? "text-emerald-600" : "text-red-600"}>
                        {entry.statusCode}
                      </span>
                    </td>
                    <td className="py-2">{entry.latencyMs} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card className="card-hover">
          <CardHeader>
            <CardTitle>Account Status</CardTitle>
            <CardDescription>Current routing eligibility by status</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {Object.entries(data.accounts.byStatus).map(([status, count]) => (
              <div key={status} className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2">
                <span className="capitalize">{status.replaceAll("_", " ")}</span>
                <span className="font-medium">{count}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SummaryCard(props: { title: string; value: string; description: string }) {
  return (
    <Card className="card-hover">
      <CardHeader>
        <CardDescription>{props.title}</CardDescription>
        <CardTitle className="text-3xl">{props.value}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">{props.description}</CardContent>
    </Card>
  );
}

function formatPercent(numerator: number, denominator: number): string {
  if (denominator === 0) {
    return "0%";
  }
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString();
}
