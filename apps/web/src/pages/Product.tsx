import { Boxes, GitBranch, Layers, Monitor, ShieldCheck, Terminal, Wrench } from "lucide-react";
import { Link } from "react-router";
import { ModuleShowcase } from "../components/marketing/ModuleShowcase.js";
import { useI18n } from "../i18n/index.js";
import { Section, SectionHeading } from "../layouts/BrandLayout.js";

const SHARED = [
  {
    icon: Boxes,
    title: "One project system",
    body: "A project owns environments, module activation and tokens. Modules never invent their own notion of a project.",
  },
  {
    icon: Layers,
    title: "One execution engine",
    body: "Scheduling, timeouts, retries, cancellation, evidence and status aggregation are implemented once, in @proofcore/engine, and validated against the shared contract.",
  },
  {
    icon: GitBranch,
    title: "One report architecture",
    body: "JSON, JUnit XML, HTML and CLI text all render from the same TestRun object, so a CI gate and a dashboard cannot disagree.",
  },
  {
    icon: ShieldCheck,
    title: "One workspace and one bill",
    body: "Entitlements, usage metering and payment state live server-side. A plan change is enforced, not styled.",
  },
];

export function Product() {
  const { t } = useI18n();
  return (
    <>
      <Section>
        <SectionHeading
          eyebrow={t("modules.eyebrow")}
          title="An integrated suite, not five tools in a tab bar"
          lede="PROOFCORE validates five independent properties of a product — reach, reliability, reversibility, safety and cleanliness — with shared machinery underneath and a module you can adopt alone."
        />
        <div className="mt-10">
          <ModuleShowcase />
        </div>
      </Section>

      <Section>
        <SectionHeading
          eyebrow="The assistant"
          title="It works on the machine, not on a screenshot of it"
          lede="The assistant opens a real browser, reads the page it rendered, acts on it and keeps the session. A terminal runs the shell itself. The tools that change files show the change before they make it."
        />
        <div className="mt-9 grid gap-5 md:grid-cols-3">
          <article className="brand-panel p-6">
            <Monitor size={20} className="text-brand-mint" />
            <h3 className="mt-4 text-[1rem] font-semibold">A browser, embedded</h3>
            <p className="mt-2 text-[0.88rem] leading-relaxed text-white/54">
              Chromium already on the machine, with tabs, cookies, keyboard, zoom and find. The
              assistant clicks and types through the same page you see.
            </p>
          </article>
          <article className="brand-panel p-6">
            <Terminal size={20} className="text-brand-mint" />
            <h3 className="mt-4 text-[1rem] font-semibold">A terminal, integrated</h3>
            <p className="mt-2 text-[0.88rem] leading-relaxed text-white/54">
              Your own shell, in the application, with colours, prompts and full-screen programs.
              The session survives navigation.
            </p>
          </article>
          <article className="brand-panel p-6">
            <Wrench size={20} className="text-brand-mint" />
            <h3 className="mt-4 text-[1rem] font-semibold">Tools that can finish the job</h3>
            <p className="mt-2 text-[0.88rem] leading-relaxed text-white/54">
              Read, search, edit, move, delete, run, fetch, audit and commit — with an exact diff
              before every write.
            </p>
          </article>
        </div>
      </Section>

      <Section tone="deeper">
        <SectionHeading eyebrow="Shared by design" title="What the modules refuse to duplicate" />
        <div className="mt-9 grid gap-5 md:grid-cols-2">
          {SHARED.map(({ icon: Icon, title, body }) => (
            <article key={title} className="brand-panel p-6">
              <Icon size={20} className="text-brand-mint" />
              <h3 className="mt-4 text-[1rem] font-semibold">{title}</h3>
              <p className="mt-2 text-[0.88rem] leading-relaxed text-white/54">{body}</p>
            </article>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/world" className="btn btn-ghost">
            WORLD
          </Link>
          <Link to="/flow" className="btn btn-ghost">
            FLOW
          </Link>
          <Link to="/exit" className="btn btn-ghost">
            EXIT
          </Link>
          <Link to="/fail" className="btn btn-ghost">
            FAIL
          </Link>
          <Link to="/clean" className="btn btn-ghost">
            CLEAN
          </Link>
          <Link to="/platform" className="btn btn-primary">
            {t("nav.platform")}
          </Link>
        </div>
      </Section>
    </>
  );
}
