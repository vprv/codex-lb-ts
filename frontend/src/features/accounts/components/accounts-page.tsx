import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createAccount, listAccounts, updateAccount, type CreateAccountInput } from "@/features/accounts/api";
import { OauthDialog } from "@/features/accounts/components/oauth-dialog";
import { useOauth } from "@/features/accounts/hooks/use-oauth";

const INITIAL_FORM: CreateAccountInput = {
  name: "",
  email: "",
  planType: "custom",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  weight: 1,
  enabled: true,
  modelAllowlist: [],
};

export function AccountsPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CreateAccountInput>(INITIAL_FORM);
  const [modelAllowlistText, setModelAllowlistText] = useState("");
  const [oauthOpen, setOauthOpen] = useState(false);
  const oauth = useOauth();

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["accounts"],
    queryFn: listAccounts,
  });

  const createMutation = useMutation({
    mutationFn: createAccount,
    onSuccess: async () => {
      setForm(INITIAL_FORM);
      setModelAllowlistText("");
      await queryClient.invalidateQueries({ queryKey: ["accounts"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard", "summary"] });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateAccount(id, { enabled }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["accounts"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard", "summary"] });
    },
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Accounts</h1>
        <p className="text-sm text-muted-foreground">
          Manage upstream OpenAI-compatible accounts used by the load balancer.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="card-hover">
          <CardHeader>
            <CardTitle>Add Account</CardTitle>
            <CardDescription>Create an API-key account or use real OpenAI OAuth.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 rounded-xl border bg-muted/20 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">OpenAI OAuth account</p>
                  <p className="text-sm text-muted-foreground">
                    Browser PKCE with device-code fallback. Tokens are stored and refreshed by the backend.
                  </p>
                </div>
                <Button type="button" onClick={() => setOauthOpen(true)}>
                  Add with OAuth
                </Button>
              </div>
            </div>
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                createMutation.mutate({
                  ...form,
                  authType: "api_key",
                  modelAllowlist: parseModelAllowlist(modelAllowlistText),
                });
              }}
            >
              <Input
                placeholder="Display name"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              />
              <Input
                placeholder="Email"
                type="email"
                value={form.email}
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              />
              <Input
                placeholder="Plan type"
                value={form.planType}
                onChange={(event) => setForm((current) => ({ ...current, planType: event.target.value }))}
              />
              <Input
                placeholder="Base URL"
                value={form.baseUrl}
                onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))}
              />
              <Input
                placeholder="API key"
                value={form.apiKey}
                onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))}
              />
              <Input
                placeholder="Weight"
                type="number"
                min={1}
                value={String(form.weight)}
                onChange={(event) =>
                  setForm((current) => ({ ...current, weight: Number(event.target.value || "1") }))
                }
              />
              <Input
                placeholder="Model allowlist, comma separated"
                value={modelAllowlistText}
                onChange={(event) => setModelAllowlistText(event.target.value)}
              />
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))}
                />
                Enabled for routing
              </label>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating…" : "Create account"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="card-hover">
          <CardHeader>
            <CardTitle>Configured Accounts</CardTitle>
            <CardDescription>Current upstream pool and routing state.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? <p className="text-sm text-muted-foreground">Loading accounts…</p> : null}
            {accounts.map((account) => (
              <div key={account.id} className="rounded-xl border bg-muted/20 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <p className="font-medium">{account.name}</p>
                    <p className="text-sm text-muted-foreground">{account.email}</p>
                    <p className="text-xs text-muted-foreground">{account.baseUrl}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-secondary px-2.5 py-1 text-xs capitalize">
                      {account.status.replaceAll("_", " ")}
                    </span>
                    <Button
                      variant={account.enabled ? "outline" : "default"}
                      onClick={() => toggleMutation.mutate({ id: account.id, enabled: !account.enabled })}
                      disabled={toggleMutation.isPending}
                    >
                      {account.enabled ? "Disable" : "Enable"}
                    </Button>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 text-sm text-muted-foreground md:grid-cols-3">
                  <span>Plan: {account.planType}</span>
                  <span>Weight: {account.weight}</span>
                  <span>Last used: {account.lastUsedAt ? new Date(account.lastUsedAt).toLocaleString() : "Never"}</span>
                </div>
                {account.modelAllowlist.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {account.modelAllowlist.map((model) => (
                      <span key={model} className="rounded-full border px-2 py-1 text-xs">
                        {model}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            {accounts.length === 0 && !isLoading ? (
              <p className="text-sm text-muted-foreground">No accounts configured yet.</p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <OauthDialog
        open={oauthOpen}
        state={oauth.state}
        onOpenChange={setOauthOpen}
        onStart={async (method) => {
          await oauth.start(method);
        }}
        onComplete={async () => {
          await queryClient.invalidateQueries({ queryKey: ["accounts"] });
          await queryClient.invalidateQueries({ queryKey: ["dashboard", "summary"] });
        }}
        onManualCallback={async (callbackUrl) => {
          await oauth.manualCallback(callbackUrl);
        }}
        onReset={oauth.reset}
      />
    </div>
  );
}

function parseModelAllowlist(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
