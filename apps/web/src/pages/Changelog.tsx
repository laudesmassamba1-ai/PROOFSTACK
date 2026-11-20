import { useI18n } from "../i18n/index.js";
import { Section, SectionHeading } from "../layouts/BrandLayout.js";

const RELEASES = [
  {
    tag: "v0.4.0",
    date: "2026-11-19",
    title: "One assistant, a real browser and a terminal",
    added: [
      "A Chromium browser inside the application: native page rendering, tabs, address bar, find, zoom and developer tools — no rendering service, no downloaded second engine",
      "Browser tools for the assistant: open, snapshot, click, type, key, scroll, select, upload, evaluate, screenshot, PDF and cookies, all over the DevTools Protocol",
      "An integrated terminal with a real PTY on Linux and macOS, streamed to the interface and running the user's own shell",
      "A wider assistant toolbox: exact-string edits, file and directory operations, HTTP requests, page reading, shell commands, Git branch/show/blame/stage and system facts",
      "One AI section: the local console now lives inside the assistant instead of a second navigation entry",
      "Automatic desktop updates from GitHub releases: AppImage updates in place, .deb installs link to the release page",
      "3D pointer tilt removed from cards and marketing tiles so text no longer moves while it is read",
    ],
    known: [
      "Desktop installers are built for Linux and Windows; macOS remains CLI-only",
      "On Windows the terminal runs in line mode: a PTY is a POSIX facility, and shipping one would mean a native module per Electron ABI",
      "The world and flow modules still drive HTTP targets; browser journeys are an assistant tool, not a module yet",
    ],
  },
  {
    tag: "v0.1.0",
    date: "2026-11-16",
    title: "Foundation",
    added: [
      "Monorepo: pnpm workspaces, topological TypeScript build, Biome, Vitest",
      "@proofcore/core — exact money, Unicode/text, IANA time zones and DST wall-clock resolution, Web Crypto ids/hashing/HMAC, canonical JSON, secret-redacting structured logger",
      "@proofcore/contracts — engine entities, statuses, configuration schema with safety refusals, billing state vocabularies, API DTOs, locale-profile schema",
      "@proofcore/engine — one scheduler for all modules, ordered and parallel-safe, timeouts, retries limited to transient faults, cancellation, findings with fingerprints and reproduction commands, evidence digests, contract-validated output",
      "@proofcore/module-world — 8 locale profiles with verified metadata, fixture expansion, HTTP and synthetic target drivers, storage-integrity comparison",
      "@proofcore/billing — plan definitions as the single price source, sparse entitlement resolution, prepaid-only capability flag",
      "Brand identity, design tokens, dotted-wave hero, modular product visuals, English and French interfaces",
    ],
    known: [
      "Web and API are live on Vercel and Cloudflare Workers with a provisioned D1 database; a production sign-up → session → overview path is verified",
      "WORLD and FLOW drive HTTP targets; Playwright browser journeys are not implemented yet",
      "SasPay live payments are untested without credentials; the sandbox provider exercises the lifecycle",
      "No email provider is configured, so verification and password-reset messages are reported as unsent rather than faked; workspace invitations reach the person inside the app",
    ],
  },
];

export function Changelog() {
  const { t } = useI18n();
  return (
    <Section>
      <SectionHeading
        eyebrow={t("nav.changelog")}
        title={t("changelog.title")}
        lede="Only releases that exist. Nothing here is a plan."
      />
      <div className="mt-10 space-y-8">
        {RELEASES.map((release) => (
          <article key={release.tag} className="brand-panel p-6">
            <header className="flex flex-wrap items-baseline gap-3">
              <h3 className="font-mono text-[1.05rem] font-semibold text-brand-mint">
                {release.tag}
              </h3>
              <span className="text-[0.82rem] text-white/42">{release.date}</span>
              <span className="text-[0.9rem] text-white/70">{release.title}</span>
            </header>
            <Block title="Added" items={release.added} tone="mint" />
            <Block title="Known limits of this build" items={release.known} tone="amber" />
          </article>
        ))}
      </div>
    </Section>
  );
}

function Block({ title, items, tone }: { title: string; items: string[]; tone: "mint" | "amber" }) {
  return (
    <div className="mt-5">
      <h4
        className={`text-[0.74rem] uppercase tracking-[0.16em] ${tone === "mint" ? "text-brand-mint" : "text-[#e9b45a]"}`}
      >
        {title}
      </h4>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item} className="flex gap-3 text-[0.86rem] leading-relaxed text-white/58">
            <span
              className={`mt-2 size-1.5 shrink-0 rounded-full ${tone === "mint" ? "bg-brand-emerald" : "bg-[#e9b45a]"}`}
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
