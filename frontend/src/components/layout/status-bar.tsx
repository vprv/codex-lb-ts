import { useMemo } from "react";
import { Activity, ArrowRightLeft, KeyRound } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { getSettings } from "@/features/settings/api";
import { getHealth } from "@/features/dashboard/api";

function getRoutingLabel(sticky: boolean, preferEarlier: boolean): string {
  if (sticky && preferEarlier) return "Sticky + Earlier reset";
  if (sticky) return "Sticky threads";
  if (preferEarlier) return "Earlier reset preferred";
  return "Weighted";
}

export function StatusBar() {
  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
    refetchInterval: 30_000,
  });

  const { data: settings } = useQuery({
    queryKey: ["settings", "detail"],
    queryFn: getSettings,
  });

  const routingLabel = settings
    ? getRoutingLabel(settings.stickyThreadsEnabled, settings.preferEarlierResetAccounts)
    : "—";
  const authLabel = useMemo(() => {
    if (!settings) {
      return "—";
    }
    return settings.proxyApiKey ? "Required" : "Disabled";
  }, [settings]);

  return (
    <footer className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/[0.08] bg-background/50 px-4 py-2 shadow-[0_-1px_12px_rgba(0,0,0,0.06)] backdrop-blur-xl backdrop-saturate-[1.8] supports-[backdrop-filter]:bg-background/40 dark:shadow-[0_-1px_12px_rgba(0,0,0,0.25)]">
      <div className="mx-auto flex w-full max-w-[1500px] flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          {health?.status === "ok" ? (
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-label="Live" />
          ) : (
            <Activity className="h-3 w-3" aria-hidden="true" />
          )}
          <span className="font-medium">Backend:</span> {health?.status === "ok" ? "Healthy" : "Unknown"}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ArrowRightLeft className="h-3 w-3" aria-hidden="true" />
          <span className="font-medium">Routing:</span> {routingLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <KeyRound className="h-3 w-3" aria-hidden="true" />
          <span className="font-medium">Proxy auth:</span> {authLabel}
        </span>
      </div>
    </footer>
  );
}
