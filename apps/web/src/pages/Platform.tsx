import { Section, SectionHeading } from "../layouts/BrandLayout.js";
import { Cpu, Database, Globe, Server, Terminal, Wind } from "lucide-react";

const STACK = [
  { icon: Globe, title: "Frontend", body: "React 19 · TypeScript · Vite · Tailwind v4 · React Router · TanStack Query · Zod. Design tokens in one stylesheet; no component carries a hex value." },
  { icon: Server, title: "Backend", body: "Cloudflare Workers · Hono · REST. Accounts, projects, configurations, billing, reports, usage, integrations. Nothing expensive runs here." },
  { icon: Database, title: "Data", body: "Cloudflare D1 · Drizzle ORM · versioned migrations. Integer minor units for money, foreign keys, tenant scoping on every query, audit history." },
  { icon: Terminal, title: "CLI & SDK", body: "TypeScript on Node 22 LTS. Browser tests, fixtures, module execution and report generation happen on the developer's machine or in their CI." },
  { icon: Cpu, title: "Engine", body: "@proofstack/engine: ordered scheduling, controlled parallelism, timeouts, cancellation, retry policy limited to transient harness faults." },
  { icon: Wind, title: "Budget", body: "Free-tier first: GitHub Free, Cloudflare Workers/D1 free quotas, open-source libraries. No paid LLM, no browser farm, no Redis, no Kubernetes." },
];

const RUNTIME_RULE = `Workers do NOT run Playwright sessions.

  customer laptop / CI                Cloudflare Workers
  ┌──────────────────────────┐        ┌───────────────────────────┐
  │ proofstack test          │  HTTPS │ auth · projects · billing │
  │  ├ engine (world/flow/   │ ─────► │ reports · usage · webhooks│
  │  │  exit) + playwright   │        └───────────────────────────┘
  │  ├ local fixtures        │
  │  └ junit/json/html out   │   only metadata + results are sent
  └──────────────────────────┘   and never by default`;

export function Platform() {
  return (
    <>
      <Section>
        <SectionHeading
          eyebrow="Architecture"
          title="A thin cloud, a thick CLI"
          lede="The expensive part of software verification is running browsers and moving data. That work belongs to the developer's machine and their CI, where it is already paid for. The cloud keeps the state that has to be shared: identity, configuration, entitlements, results."
        />
        <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {STACK.map(({ icon: Icon, title, body }) => (
            <article key={title} className="brand-panel p-5">
              <Icon size={19} className="text-brand-cyan" />
              <h3 className="mt-4 text-[0.96rem] font-semibold">{title}</h3>
              <p className="mt-2 text-[0.84rem] leading-relaxed text-white/52">{body}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section tone="deeper">
        <SectionHeading eyebrow="Runtime separation" title="The rule that keeps the bill at zero" />
        <pre className="brand-panel mt-8 overflow-x-auto p-5 font-mono text-[0.72rem] leading-relaxed text-white/72">
          {RUNTIME_RULE}
        </pre>
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          <article className="brand-panel p-6">
            <h3 className="text-[0.98rem] font-semibold">Shared entities</h3>
            <p className="mt-2 text-[0.86rem] leading-relaxed text-white/52">
              Project · Workspace · Environment · Module · Test suite · Test case · Test run · Module run · Assertion ·
              Finding · Evidence · Report · Integration. Every case carries id, name, module, description, status,
              severity, start, end, duration, environment, revision, failure information and reproduction instructions.
            </p>
          </article>
          <article className="brand-panel p-6">
            <h3 className="text-[0.98rem] font-semibold">Evidence policy</h3>
            <p className="mt-2 text-[0.86rem] leading-relaxed text-white/52">
              Logs, steps, screenshots on browser failure, comparison summaries, checksums and metadata. Large artefacts
              stay in CI artifacts or local storage; D1 receives a pointer and a SHA-256 digest, never a trace file.
            </p>
          </article>
        </div>
      </Section>
    </>
  );
}
