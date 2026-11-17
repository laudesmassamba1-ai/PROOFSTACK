import { Link } from "react-router";
import { TesterScene } from "../components/app/Testers.js";
import { useI18n } from "../i18n/index.js";
import { Section } from "../layouts/BrandLayout.js";

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
