# Architecture

This document describes what runs where, and why. It is deliberately narrow: the
product architecture (modules, engine, reports) is documented by the packages
themselves; this file covers the SaaS layer added on top of them.

## Runtime split

PROOFCORE is not a browser-testing service. That boundary is the central
architectural decision:

| Work                                                              | Runs on                   | Why                                                                      |
| ----------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------ |
| Accounts, workspaces, projects, reports, usage, billing, webhooks | `apps/api`                | small, cacheable, request/response workloads                             |
| WORLD fixtures, FLOW journeys, EXIT exports, browser sessions     | customer CLI / CI         | browser sessions need minutes, a real browser and the customer's network |
| Marketing site and dashboard                                      | `apps/web` (static build) | no server-side rendering requirement; deployable to any static host      |

The CLI uploads **metadata and findings** to the API, not traces or videos. Large
evidence stays in CI artifacts; a `ref` points at it. D1 is not a blob store.

## Application layout

```
apps/api/
  migrations/             plain SQL, applied by Wrangler (D1) or node:sqlite
  src/
    app.ts                Hono app factory: middleware, mounting, error envelope
    worker.ts             Cloudflare Worker entry (D1 binding)
    node.ts               local Node 22 server (SQLite), zero paid infrastructure
    db/                   database port + Node and D1 adapters + migration runner
    store/                tenant data (AppStore) and billing persistence
    http/                 guards, DTOs, error mapping, composition root
    routes/               auth, workspace, machine (CLI), billing, webhooks
  test/api.test.ts        integration tests against real SQLite and real engines
```

`createApp({ db, env, provider })` is the single composition root. The Worker, the
Node dev server and the tests all use it, so an integration test exercises the same
wiring production uses.

### Persistence: SQL, not an ORM

The target is Cloudflare D1, which is SQLite. Local development and tests use
Node's built-in `node:sqlite`, wrapped in D1's `prepare().bind().all()/first()/run()`
interface (about 40 lines, `src/db/node-sqlite.ts`). Consequences:

- the same SQL runs locally and in production;
- migrations are reviewable files, not generated artifacts;
- there is exactly one place where a tenant filter can be forgotten, and the tests
  check it.

Drizzle was evaluated and not used for this layer. It is a good ORM, but with two
runtimes and a single dialect it would add a code generator, a build artifact and a
schema translation layer without removing the need to write and review the SQL.
This is a reversible decision: the `Database` port is the seam.

Billing rows keep amounts as **integer minor-unit strings** plus an ISO currency.
`payment_intents.amount_minor` is never a float and is never recomputed from a
client value.

### Auth: first-party sessions

The auth surface is intentionally small: email/password, one HttpOnly session
cookie, no social login yet.

- Passwords: PBKDF2-HMAC-SHA256, 100 000 iterations (the Workers WebCrypto
  ceiling), 16-byte random salt, stored as
  `pbkdf2-sha256$<iterations>$<salt>$<hash>`. Iteration count is read from the stored
  record, so it can be raised without invalidating existing hashes.
- Sessions: 32 random bytes, sent as `ps_session`, `HttpOnly`, `SameSite=Lax`,
  `Secure` whenever the web origin is HTTPS (or in production). Only a SHA-256 hash
  is stored, so a database leak does not yield live cookies.
- Sign-in answers the same message for "unknown email" and "wrong password".
- State-changing cookie requests are checked against `WEB_ORIGIN`; a cross-site
  `Origin` is rejected.
- Rate limiting: fixed-window, in-memory per isolate, on sign-in/sign-up. It is a
  speed bump, not a distributed guarantee. The API's paid traffic is metered in the
  database, where the limit is authoritative.

Better Auth was evaluated. Its D1 support requires an adapter plus a schema we would
still own, and none of its plugins is needed for this surface. A first-party
implementation is smaller to audit and runs unchanged on Workers and Node. If social
login, MFA or organisations are added, migrating to Better Auth (or Managed Better
Auth on Neon) remains possible; the session table is ordinary data.

Email verification and password recovery are **not implemented**. Transactional email
has two adapters: EmailJS (preferred) and Resend (fallback). They are selected at call
time and journal to `email_outbox` with `unconfigured` when neither is set. No production
credentials were supplied, so real delivery is unverified; the API still says
`emailVerification: "not_configured"` instead of claiming an email was sent. The adapter
boundary is documented in `docs/deployment/ENVIRONMENT_VARIABLES.md`.

### Scanning someone else's site

`POST /api/v1/audits` fetches a page and reports five families: FAIL (security), CLEAN
(interface), FLOW (does the journey have an entry point, does it answer, how would it be
paid), WORLD (internationalisation), EXIT (data portability). It needs no configuration,
which is the point: `proofcore scan <url>` runs the same engine from the CLI.

Two rules make this safe to offer as a public feature.

**Ownership decides detail.** A localhost or private target belongs to the person running
the command, so the report names paths and statuses. A remote site is `unverified` until its
owner publishes a token (`<meta name="proofcore-verification">` or
`/.well-known/proofcore-verification.txt`, minted per workspace and stored in
`site_verifications`). An unverified report keeps the categories, the counts and the advice
and drops every locator: a tool that lists exact paths and header values on demand is a
target-ranking service, whether or not that was the intent. Redaction happens inside
`scanPage`, so a caller that forgets cannot leak.

**Credentials are borrowed, not kept.** For a product behind a login the caller may supply an
account created for the audit (`login: {url, email, password}`). It is used for that one
scan: the API posts it, keeps the cookie for the page fetch, and stores neither. A login that
sets no cookie is reported as failed rather than as "signed in" — a scan of public pages must
not be labelled otherwise.

`FLOW` here is a page-level reading, not the engine's checkout walk: `webhook_observability`
is `SKIPPED` with that reason, and the engine module still needs the product's endpoints.

### Membership requires consent

`workspace_invitations` holds the request; `workspace_members` holds the membership, and
only an `accept` creates the second from the first. Before this, `POST …/members` wrote the
membership row directly: one person granted another access to a tenant without asking, and
the notification the product advertised did not exist.

- Inviting an existing account creates a `pending` row and notifies the invitee (email when
  a provider is configured, and the in-app list at `/api/account/invitations` always).
- The answer is a conditional `UPDATE … WHERE status = 'pending'`, so two tabs cannot both
  accept and a revoked invitation cannot be revived.
- Someone else's invitation answers **404**, like any other tenant-scoped id.
- A partial unique index keeps one pending invitation per person per workspace while still
  allowing a later re-invitation after a decline.

The CLI's `/modules` entry points at `/app/modules`: a page that lists the five modules with
the exact command that runs them. Any link the CLI can open has to be a real route — that
page did not exist and fell through to the 404.

### Web origins

Credentialed calls are accepted only from an allowlist (`WEB_ORIGIN`), matched by
`originAllowed()`: exact hostnames plus `*` for exactly one label, which is how preview
deployments (`6f0fee2d.proofstack-01z.pages.dev`) are covered without allowing an
attacker-controlled `*.pages.dev`. The guard runs on every non-GET `/api/*` request —
account and auth routes included — and `/api/webhooks/*` is exempt because those calls are
signature-authenticated and carry no `Origin`. Renaming a Pages project changes its
hostname: a deployment that suddenly answers `cross_origin_denied` is almost always a
missing entry here, which is why the error names the refused origin.

### Tenant isolation

Every tenant-owned query takes the caller's workspace as an argument and filters on
it. There is no `getProject(id)`; the method is `getProject(workspaceId, projectId)`.
A workspace the caller is not a member of answers **404**, not 403, so ids cannot be
enumerated. Roles are `owner | admin | member | viewer`, and destructive or billing
actions require owner/admin. Project tokens are scoped to one project, hashed at
rest, and can only `runs:write` / `reports:read`.

### List endpoints

Every list that can grow answers the same shape, built by `http/pagination.ts`:

```json
{ "items": [], "total": 340, "limit": 25, "offset": 0 }
```

`limit` is clamped to 1–100 and an unparsable value falls back to the default instead of
reaching SQL as `NaN`; `offset` is never negative. `total` is always present, because a
page that omits it reads as "this is everything" — the old conversation list stopped at 50
rows and silently hid the rest, and the runs list accepted a `limit` with no way to reach
page two. Pagination is a visibility guarantee, not an optimisation.

The corresponding queries are backed by indexes that match their `ORDER BY`
(migration `0010`), and a test asserts the query plan keeps using them: a missing index
fails slowly, and `EXPLAIN QUERY PLAN` is the only place that shows it.

On the client, `lib/usePagedList.ts` owns the four states (rows, total, loading, error) and
`components/app/LoadMore.tsx` renders the control, so "load more" cannot behave three
different ways in three screens.

### Reports

`POST /v1/runs` accepts the exact `TestRun` contract the engine produces. The server:

1. requires `Idempotency-Key`;
2. checks the run's workspace against the API key, not the payload;
3. recomputes totals from `moduleRuns` so a summary cannot disagree with its cases;
4. meters usage once per **run id**, not per request;
5. stores the run, one report (unique index on `run_id`) and extracted findings.

A harness error or cancelled run is recorded with `not_counted`: the customer sees it
but is not billed for our failure. `GET /api/v1/reports/:id` serves the stored payload
as JSON or a self-contained HTML download.

### Billing authority

The rule is short: **a browser redirect never grants access**.

```
checkout/start → intent CREATED, provider session, idempotency key persisted
provider acts out of band (push, hosted page, USSD)
server verifies   → only SUCCEEDED credits the period
webhook           → signature over the raw body, unique event id, then the same verify
entitlements      → resolved from the subscription row on every privileged request
```

`packages/billing` owns the state machines, entitlement engine, usage meter and
checkout orchestration. `apps/api` supplies a SQL implementation of its `BillingStore`
whose unique constraints are the correctness guarantees:

| Constraint                                     | Guarantee                     |
| ---------------------------------------------- | ----------------------------- |
| `payment_intents.idempotency_key`              | one charge per billing period |
| `webhook_events(provider, provider_event_id)`  | replay is a no-op             |
| `usage_events(workspace_id, kind, dedupe_key)` | metered once per subject      |
| `invoices.payment_attempt_id`                  | one receipt per payment       |
| `reports.run_id`                               | one report per run            |

Provider capabilities are read from `getCapabilities()`, never inferred. SasPay
exposes no refund and no recurring endpoint, so the product sells **prepaid periods
with manual renewal** and says so. The deterministic sandbox provider exists so the
whole path is testable without credentials; it is selected only when
`SASPAY_API_KEY` and `SASPAY_WEBHOOK_SECRET` are both absent.

## Deployment shape

| Component  | Target                                              | Cost assumption                 |
| ---------- | --------------------------------------------------- | ------------------------------- |
| `apps/web` | static assets (Cloudflare Pages or any static host) | free tier                       |
| `apps/api` | Cloudflare Workers                                  | free tier request limits        |
| database   | Cloudflare D1                                       | free tier row read/write limits |
| tests      | customer CLI / GitHub Actions                       | customer's CI minutes           |

Free-tier limits change and must be re-checked before launch; see
`docs/deployment/ENVIRONMENT_VARIABLES.md` and the operational limits section of the
status file. Nothing in the product requires Redis, a GPU, a paid LLM or a browser
farm.

## Known limitations

- No email verification or password reset. EmailJS/Resend adapters exist, but real
  delivery was not verified without credentials.
- Invitations are persisted and shown in-app; their email depends on the configured
  provider, and there is no fallback that pretends it was sent.
- Plans are defined in `packages/billing/src/plans.ts` and seeded once; the database
  does not yet let an operator change a price without a deploy.
- No admin billing UI; refunds are administrative because SasPay has no refund route.
- Local sandbox provider state is per process/isolate. It is a development surface,
  not durable storage.
