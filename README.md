# codex-lm-ts

TypeScript port of a Codex/ChatGPT account load balancer with a dashboard, SQLite storage, and OAuth-backed account onboarding.

This repo currently provides:

- Fastify backend on `2455`
- React dashboard on `5173`
- OAuth callback listener on `1455`
- SQLite persistence for accounts, settings, and request logs
- OAuth account storage with refresh-token based renewal

## What Works Today

- Start backend and frontend together with one command
- Add accounts from the dashboard using real OpenAI OAuth
- Configure Codex CLI to point at this proxy
- Persist and refresh OAuth account tokens

## Current Limitation

OAuth account onboarding is implemented, but full `codex-cli` request-shape compatibility is still incomplete.

The upstream ChatGPT Codex backend is stricter than standard OpenAI Responses API. Until the request adapter is completed, direct proxy requests may still require upstream-native fields like:

- `instructions`
- `input` as a list
- `store: false`
- `stream: true`

## Start The Project

### Local Development

Install dependencies:

```bash
npm install
cd frontend && npm install --legacy-peer-deps && cd ..
```

Run backend and frontend together:

```bash
npm run dev
```

Services:

- backend API: `http://127.0.0.1:2455`
- frontend dashboard: `http://127.0.0.1:5173`
- OAuth callback: `http://127.0.0.1:1455/auth/callback`

Backend only:

```bash
npm run dev:backend
```

Frontend only:

```bash
npm run dev:frontend
```

### Docker Compose

Run the full project in Docker:

```bash
docker compose up --build
```

Services:

- backend API: `http://127.0.0.1:2455`
- frontend dashboard: `http://127.0.0.1:5173`
- OAuth callback: `http://127.0.0.1:1455/auth/callback`

The compose setup exposes port `1455` so browser OAuth can finish outside the container.

## Important Environment Variables

Defaults are already set in code, but these are the main ones:

```bash
HOST=0.0.0.0
PORT=2455
DB_PATH=./data/codex-lm-ts.db

AUTH_BASE_URL=https://auth.openai.com
OAUTH_CLIENT_ID=app_EMoamEEZ73f0CkXaXp7hrann
OAUTH_SCOPE="openid profile email offline_access"
OAUTH_REDIRECT_URI=http://localhost:1455/auth/callback
OAUTH_CALLBACK_HOST=127.0.0.1
OAUTH_CALLBACK_PORT=1455
```

For Docker, the compose file already overrides `OAUTH_CALLBACK_HOST=0.0.0.0`.

## Add An Account

### Recommended: Dashboard OAuth Flow

1. Start the project.
2. Open `http://127.0.0.1:5173`.
3. Go to `Accounts`.
4. Click `Add with OAuth`.
5. Choose:
   - `Browser (PKCE)` for normal local login
   - `Device code` for headless or remote setups
6. Complete the OpenAI sign-in flow.

After success, the account is stored in SQLite and will be refreshed automatically before proxy use.

### Browser OAuth Notes

- The callback listener uses `http://localhost:1455/auth/callback`
- Port `1455` must be reachable from your browser
- If the callback cannot reach the app directly, paste the callback URL into the dialog’s manual callback input

### Manual API-Key Accounts

The dashboard still supports manual upstream accounts, but if your goal is Codex/ChatGPT OAuth-backed usage, use the OAuth dialog instead.

## Configure Codex CLI

Edit `~/.codex/config.toml`:

```toml
model = "gpt-5.3-codex"
model_provider = "codex-lm-ts"

[model_providers.codex-lm-ts]
name = "OpenAI"
base_url = "http://127.0.0.1:2455/backend-api/codex"
wire_api = "responses"
```

If you enabled proxy API key enforcement in dashboard settings, add:

```toml
[model_providers.codex-lm-ts]
name = "OpenAI"
base_url = "http://127.0.0.1:2455/backend-api/codex"
wire_api = "responses"
env_key = "CODEX_LM_TS_API_KEY"
```

And export it:

```bash
export CODEX_LM_TS_API_KEY="your-proxy-key"
```

## Basic Health Checks

Backend health:

```bash
curl http://127.0.0.1:2455/health
```

List models through the proxy:

```bash
curl http://127.0.0.1:2455/backend-api/codex/models
```

Test a manual upstream-native request:

```bash
curl -N -X POST http://127.0.0.1:2455/backend-api/codex/responses \
  -H 'content-type: application/json' \
  -d '{
    "model": "gpt-5.3-codex",
    "instructions": "You are a helpful coding assistant.",
    "store": false,
    "stream": true,
    "input": [
      {
        "role": "user",
        "content": [
          {
            "type": "input_text",
            "text": "Write a hello world program in TypeScript."
          }
        ]
      }
    ]
  }'
```

## Cherry Studio

The proxy supports [Cherry Studio](https://github.com/CherryHQ/cherry-studio) via both the **OpenAI Responses API** and Chat Completions.

### Using Responses API (recommended)

1. In Cherry Studio, go to **Settings → Providers** and add a new provider.
2. Choose **OpenAI** (Responses API) — not "OpenAI-Compatible".
3. Set **API Base URL** to `http://localhost:2455` (or your backend URL). Do not add `/v1` — Cherry Studio appends it.
4. Set **API Key** to your proxy API key (from dashboard Settings) if you enabled proxy auth.
5. Add the Codex models (e.g. `gpt-5.3-codex`) and enable the provider.

Cherry Studio will send requests to `POST /v1/responses`, which the proxy forwards to Codex. The Responses API format is compatible with Codex.

### Using Chat Completions

If you prefer **OpenAI-Compatible** (Chat Completions), use the same base URL. The proxy adapts requests to Codex and transcodes the streamed response.

## Main Endpoints

- `GET /health`
- `GET /api/accounts`
- `POST /api/accounts`
- `PATCH /api/accounts/:id`
- `POST /api/oauth/start`
- `GET /api/oauth/status`
- `POST /api/oauth/complete`
- `POST /api/oauth/manual-callback`
- `GET /api/settings`
- `PUT /api/settings`
- `GET /api/dashboard/summary`
- `GET /api/request-logs`
- `GET /v1/models`
- `POST /v1/chat/completions` (Cherry Studio / OpenAI Chat Completions)
- `POST /v1/responses`
- `GET /backend-api/codex/models`
- `POST /backend-api/codex/responses`

## Verification

Backend:

```bash
npm run typecheck
npm test
```

Frontend:

```bash
cd frontend
npm run typecheck
npm run build
```
