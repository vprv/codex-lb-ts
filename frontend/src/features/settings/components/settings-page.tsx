import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getSettings, updateSettings, type AppSettings } from "@/features/settings/api";

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["settings", "detail"],
    queryFn: getSettings,
  });
  const [form, setForm] = useState<AppSettings>({
    stickyThreadsEnabled: false,
    preferEarlierResetAccounts: false,
    proxyApiKey: null,
  });

  useEffect(() => {
    if (data) {
      setForm(data);
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings", "detail"] });
    },
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure routing behavior and optional incoming proxy authentication.
        </p>
      </div>

      <Card className="max-w-2xl card-hover">
        <CardHeader>
          <CardTitle>Backend Settings</CardTitle>
          <CardDescription>These values are stored in the TypeScript backend SQLite database.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? <p className="text-sm text-muted-foreground">Loading settings…</p> : null}
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              mutation.mutate(form);
            }}
          >
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.stickyThreadsEnabled}
                onChange={(event) =>
                  setForm((current) => ({ ...current, stickyThreadsEnabled: event.target.checked }))
                }
              />
              Enable sticky threads
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.preferEarlierResetAccounts}
                onChange={(event) =>
                  setForm((current) => ({ ...current, preferEarlierResetAccounts: event.target.checked }))
                }
              />
              Prefer earlier-reset accounts
            </label>

            <div className="space-y-2">
              <label className="text-sm font-medium">Proxy API key</label>
              <Input
                placeholder="Leave empty to disable"
                value={form.proxyApiKey ?? ""}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    proxyApiKey: event.target.value.trim() ? event.target.value : null,
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">
                When set, `/v1` and `/backend-api/codex` require `Authorization: Bearer &lt;key&gt;`.
              </p>
            </div>

            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving…" : "Save settings"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
