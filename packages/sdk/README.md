# @proofcore/sdk

Typed HTTP client for the PROOFCORE **machine API**. Private workspace package: it is
not published to npm, and nothing here is a hosted service.

## What it covers

Only the routes a project token (`psk_…`) can call:

| Method                                | Route             | Purpose                                             |
| ------------------------------------- | ----------------- | --------------------------------------------------- |
| `getProject()`                        | `GET /v1/project` | Workspace, project, plan and monthly test-run usage |
| `uploadRun(body, { idempotencyKey })` | `POST /v1/runs`   | Upload a finished run, idempotently                 |

Everything else the product exposes (workspaces, projects, reports, analyses, the
assistant) is authenticated by a session cookie plus a CSRF token. That is a browser
credential, not a server-to-server one, so it is deliberately absent here instead of
being reimplemented with the wrong auth.

## Usage

```ts
import { createProofcoreClient } from "@proofcore/sdk";

const client = createProofcoreClient({
  baseUrl: "https://proofcore-api.example.com",
  tokenEnvVar: "PROOFCORE_API_TOKEN", // the name, never the key
});

const { project, usage } = await client.getProject();

await client.uploadRun(
  { run, summary: { totals: { world: totals } } },
  { idempotencyKey: `ci:${run.id}` }
);
```

`tokenEnvVar` is resolved on every call, so rotating the secret does not need a new
client. A literal `token` is validated when the client is built.

Create the token in the app (Workspace → API keys) or with `POST /api/v1/api-keys`
(owner/admin, `api_access` entitlement). The plaintext appears once.

## Errors

`ProofcoreApiError` carries the server's stable `code` (`invalid_api_key`,
`scope_missing`, `idempotency_key_required`, `quota_exhausted`, `rate_limited`…),
plus `status`, `category`, `details`, `requestId` and, on `429`, `retryAfterSeconds`.
`code: "invalid_response"` means the server answered `2xx` with a body this version does
not recognise — returned as an error rather than a cast.

The client never retries on its own: a retry is the caller's decision, taken with the
`Idempotency-Key` it owns.

## Development

```bash
npx vitest run packages/sdk/test/sdk.test.ts
pnpm --filter @proofcore/sdk typecheck
```

The tests run the SDK against the real API routes through `apps/api/test/harness.ts`;
the transport is the only synthetic part.
