import { Boxes, GitBranch, Layers, ShieldCheck } from "lucide-react";
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
    body: "Scheduling, timeouts, retries, cancellation, evidence and status aggregation are implemented once, in @proofstack/engine, and validated against the shared contract.",
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
          title="An integrated suite, not three tools in a tab bar"
          lede="PROOFSTACK validates three independent properties of a product — reach, reliability and reversibility — with shared machinery underneath and a module you can adopt alone."
        />
        <div className="mt-10">
          <ModuleShowcase />
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
          <Link to="/platform" className="btn btn-primary">
            {t("nav.platform")}
          </Link>
        </div>
      </Section>
    </>
  );
}
