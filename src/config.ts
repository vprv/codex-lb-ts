import path from "node:path";

export interface AppConfig {
  host: string;
  port: number;
  dbPath: string;
  authBaseUrl: string;
  oauthClientId: string;
  oauthScope: string;
  oauthRedirectUri: string;
  oauthCallbackHost: string;
  oauthCallbackPort: number;
}

export function getConfig(): AppConfig {
  return {
    host: process.env.HOST ?? "0.0.0.0",
    port: Number(process.env.PORT ?? 2455),
    dbPath: process.env.DB_PATH ?? path.join(process.cwd(), "data", "codex-lm-ts.db"),
    authBaseUrl: process.env.AUTH_BASE_URL ?? "https://auth.openai.com",
    oauthClientId: process.env.OAUTH_CLIENT_ID ?? "app_EMoamEEZ73f0CkXaXp7hrann",
    oauthScope: process.env.OAUTH_SCOPE ?? "openid profile email offline_access",
    oauthRedirectUri: process.env.OAUTH_REDIRECT_URI ?? "http://localhost:1455/auth/callback",
    oauthCallbackHost: process.env.OAUTH_CALLBACK_HOST ?? "127.0.0.1",
    oauthCallbackPort: Number(process.env.OAUTH_CALLBACK_PORT ?? 1455)
  };
}
