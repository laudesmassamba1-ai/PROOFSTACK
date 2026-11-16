# Environment variables

## Operations console

`ADMIN_EMAILS` is a comma-separated allowlist of account emails allowed to read
`/api/v1/admin/overview` and the `/app/admin` page. It is an authorization list, not a
secret. An empty value disables the console (503 `admin_not_configured`); there is no
"first user becomes admin" fallback. Set it in `apps/api/wrangler.toml` under `[vars]`
for the Worker, or in the local environment for `pnpm api:dev`:

```bash
ADMIN_EMAILS="you@example.com" pnpm api:dev
```

The console is read-only: users, workspaces, subscriptions, payments, runs and webhook
delivery. It never selects password hashes or session tokens.

## Current deployment

- Web: `https://proofstack-iota.vercel.app`; `vercel.json` proxies `/api/*`, `/v1/*`
  and `/health` to the API, so `VITE_API_URL` is built as `/` (empty base URL) and the
  session cookie remains same-origin.
- API: `https://proofstack-api.laudesmassamba1.workers.dev`; `WEB_ORIGIN` and
  `API_ORIGIN` are set in `apps/api/wrangler.toml` for that pair of hosts.
- D1: database `proofstack`; `wrangler d1 migrations apply proofstack --remote`.

No secret is ever committed. `.dev.vars.example` files list names with empty values;
real values live in the host's secret store (Worker secrets) or a local, ignored file.

## API (`apps/api`)

| Variable                 | Required    | Purpose                                                                                                                                                  |
| ------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WEB_ORIGIN`             | production  | Public origin of the web app. Cookies are issued against it, CORS allows only it, and cross-origin writes are rejected. Default `http://localhost:5173`. |
| `API_ORIGIN`             | recommended | Public origin of the API, used for documentation and callbacks. Default `http://localhost:8787`.                                                         |
| `NODE_ENV`               | production  | `production` forces `Secure` cookies.                                                                                                                    |
| `PORT`, `HOST`           | local only  | Node dev server bind. Default `8787`, `127.0.0.1`.                                                                                                       |
| `DATA_PATH`              | local only  | SQLite file for the Node dev server. Default `.proofstack/api.db` (git-ignored).                                                                         |
| `SASPAY_API_KEY`         | optional    | `sk_test_…` in development, `sk_live_…` in production. Without it the API uses the sandbox provider.                                                     |
| `SASPAY_WEBHOOK_SECRET`  | optional    | Signing secret shown once when the webhook is created in the SasPay dashboard. Required together with the key.                                           |
| `SASPAY_BASE_URL`        | optional    | Override the API base URL. Defaults to the sandbox URL for `sk_test_` keys and the live URL otherwise.                                                   |
| `SASPAY_FEE_CHARGE_MODE` | optional    | `ADD_ON` (payer covers fees) or `DEDUCTED` (fees taken from the net). Default `ADD_ON`.                                                                  |

On Cloudflare, the database is a binding, not a variable:

```toml
[[d1_databases]]
binding = "DB"
database_name = "proofstack"
database_id = "…"
```

Set secrets with `wrangler secret put SASPAY_API_KEY` and
`wrangler secret put SASPAY_WEBHOOK_SECRET`. Never put them in `wrangler.toml`.

## Web (`apps/web`)

| Variable       | Required   | Purpose                                                                                                                                        |
| -------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_API_URL` | production | API origin, e.g. `https://api.example.com`. Default `http://localhost:8787`. This is compiled into the bundle: it is an address, not a secret. |

## CLI and CI

| Variable                    | Purpose                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| `PROOFSTACK_PROJECT_TOKEN`  | `psk_…` project token created in the dashboard. Read at call time; never written to a report.  |
| `PROOFSTACK_WORLD_TOKEN`    | Bearer token for the application under test (WORLD/EXIT targets).                              |
| `PROOFSTACK_FLOW_TOKEN`     | Bearer token for the FLOW target.                                                              |
| `PROOFSTACK_WEBHOOK_SECRET` | Secret used to sign webhooks the FLOW harness sends to the app under test.                     |
| `PROOFSTACK_API_URL`        | API origin for `login`, `ui` and `status`. Defaults to the live Vercel deployment.             |
| `PROOFSTACK_SESSION_COOKIE` | Full `ps_session=…` cookie for headless/CI use. Treat it as a secret; never commit it.         |
| `PROOFSTACK_SESSION_FILE`   | Override the session file path. Defaults to `~/.config/proofstack/session.json` (mode `0600`). |
| `PROOFSTACK_CONFIG_HOME`    | Override the config directory used when `XDG_CONFIG_HOME` is not set.                          |

`proofstack login` is interactive and stores only the HttpOnly session cookie, with
mode `0600`; the password is never persisted. `proofstack logout` removes it.

## Email delivery (not configured)

There is no email provider in this build, so the API reports
`emailVerification: "not_configured"` rather than pretending to send mail. When one
is added, it must live behind an adapter and read its key from the environment, e.g.
`EMAIL_API_KEY` + `EMAIL_FROM`. Until then, do not claim verification emails work.

## Free-tier notes

Cloudflare's Free plan limits Workers requests/CPU and D1 reads/writes/storage, and
those limits change. The API is designed to keep usage low:

- sessions are touched at most once per hour, not on every request;
- uploads are capped and reports store metadata plus findings, not traces;
- the CLI performs all browser work locally or in CI.

Re-check the current quotas before a public launch and monitor the D1 write volume.
