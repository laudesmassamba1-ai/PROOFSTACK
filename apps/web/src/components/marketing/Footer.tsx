import { Link } from "react-router";
import { useI18n } from "../../i18n/index.js";
import { Wordmark } from "../brand/Logo.js";

export function Footer() {
  const { t } = useI18n();
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-white/8 bg-[#050708]">
      <div className="mx-auto grid max-w-[1240px] gap-10 px-5 py-14 md:grid-cols-[1.4fr_1fr_1fr_1fr] lg:px-8">
        <div>
          <Wordmark size={14} />
          <p className="mt-4 max-w-[34ch] text-[0.86rem] leading-relaxed text-white/48">
            {t("footer.tagline")}
          </p>
        </div>
        <FooterColumn
          title={t("footer.product")}
          items={[
            { to: "/product", label: t("nav.product") },
            { to: "/world", label: "WORLD" },
            { to: "/flow", label: "FLOW" },
            { to: "/exit", label: "EXIT" },
            { to: "/fail", label: "FAIL" },
            { to: "/clean", label: "CLEAN" },
            { to: "/pricing", label: t("nav.pricing") },
          ]}
        />
        <FooterColumn
          title={t("footer.developers")}
          items={[
            { to: "/docs", label: t("nav.docs") },
            { to: "/platform", label: t("nav.platform") },
            { to: "/changelog", label: t("nav.changelog") },
            { to: "/security", label: t("nav.security") },
          ]}
        />
        <FooterColumn
          title={t("footer.company")}
          items={[
            { to: "/support", label: t("footer.support") },
            { to: "/legal/terms", label: t("footer.terms") },
            { to: "/legal/privacy", label: t("footer.privacy") },
            { to: "/legal/cookies", label: t("footer.cookies") },
            { to: "/signin", label: t("nav.signin") },
          ]}
        />
      </div>
      <div className="mx-auto flex max-w-[1240px] flex-col gap-2 border-t border-white/8 px-5 py-6 text-[0.76rem] text-white/35 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <p>{t("footer.rights").replace("{year}", String(year))}</p>
        <p>{t("footer.notAffiliated")}</p>
      </div>
    </footer>
  );
}

function FooterColumn({ title, items }: { title: string; items: { to: string; label: string }[] }) {
  return (
    <div>
      <h4 className="text-[0.74rem] uppercase tracking-[0.18em] text-white/40">{title}</h4>
      <ul className="mt-4 space-y-2.5">
        {items.map((item) => (
          <li key={`${item.to}-${item.label}`}>
            <Link
              to={item.to}
              className="text-[0.88rem] text-white/68 transition-colors hover:text-white"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
