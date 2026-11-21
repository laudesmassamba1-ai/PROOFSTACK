import { Link } from "react-router";
import { TesterScene } from "../components/app/Testers.js";
import { useI18n } from "../i18n/index.js";
import { Section } from "../layouts/BrandLayout.js";

export function AppNotFound() {
  const { t } = useI18n();
  return (
    <div className="app-page">
      <p className="app-eyebrow">404 / PROOFSTACK</p>
      <h1 className="app-display mt-3 text-[clamp(2rem,5vw,3.4rem)]">{t("notfound.title")}</h1>
      <p className="mt-3 max-w-[560px] text-sm leading-relaxed text-muted">{t("notfound.body")}</p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Link to="/app" className="app-btn app-btn-primary">
          {t("notfound.cta")}
        </Link>
        <Link to="/app/cli/docs" className="app-btn">
          CLI / guide
        </Link>
      </div>
    </div>
  );
}

export function NotFound() {
  const { t } = useI18n();
  return (
    <Section className="min-h-[60vh] max-w-[760px]">
      <TesterScene variant="lost" className="notfound-tester" />
      <p className="eyebrow mt-4">404</p>
      <h1 className="mt-3 text-[2rem] tracking-tight">{t("notfound.title")}</h1>
      <p className="mt-3 text-white/54">{t("notfound.body")}</p>
      <Link to="/" className="btn btn-primary mt-7">
        {t("notfound.cta")}
      </Link>
    </Section>
  );
}
