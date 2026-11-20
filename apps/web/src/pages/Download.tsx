import { Download as DownloadIcon, Monitor, Package, Terminal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n/index.js";
import { Section, SectionHeading } from "../layouts/BrandLayout.js";

const REPO = "laudesmassamba1-ai/PROOFSTACK";
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

interface Asset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface Release {
  tag_name: string;
  html_url: string;
  assets: Asset[];
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const mb = bytes / (1024 * 1024);
  return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

function pickDesktop(assets: Asset[]) {
  const desktop = assets.filter((a) => a.name.startsWith("PROOFCORE-"));
  return {
    windows: desktop.find((a) => a.name.endsWith(".exe")) ?? null,
    deb: desktop.find((a) => a.name.endsWith(".deb")) ?? null,
    appImage: desktop.find((a) => a.name.endsWith(".AppImage")) ?? null,
  };
}

export function DownloadPage() {
  const { t, locale } = useI18n();
  const fr = locale === "fr";
  const [release, setRelease] = useState<Release | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let alive = true;
    fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as Release;
      })
      .then((data) => {
        if (!alive) return;
        setRelease(data);
        setState("ready");
      })
      .catch(() => {
        if (alive) setState("error");
      });
    return () => {
      alive = false;
    };
  }, []);

  const picks = useMemo(() => (release ? pickDesktop(release.assets) : null), [release]);
  const version = release?.tag_name?.replace(/^v/, "") ?? "0.4.0";

  return (
    <Section>
      <SectionHeading
        eyebrow={t("download.eyebrow")}
        title={t("download.title")}
        lede={t("download.lede")}
      />

      <div className="mt-10 grid gap-5 lg:grid-cols-3">
        <DownloadCard
          icon={Monitor}
          title={fr ? "Windows" : "Windows"}
          subtitle={fr ? "Application de bureau (.exe)" : "Desktop app (.exe)"}
          asset={picks?.windows ?? null}
          loading={state === "loading"}
          primary
          fallback={RELEASES_PAGE}
          cta={t("download.cta")}
        />
        <DownloadCard
          icon={Package}
          title="Linux"
          subtitle={fr ? "Paquet Debian (.deb)" : "Debian package (.deb)"}
          asset={picks?.deb ?? null}
          loading={state === "loading"}
          fallback={RELEASES_PAGE}
          cta={t("download.cta")}
        />
        <DownloadCard
          icon={Package}
          title="Linux"
          subtitle="AppImage"
          asset={picks?.appImage ?? null}
          loading={state === "loading"}
          fallback={RELEASES_PAGE}
          cta={t("download.cta")}
        />
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-4">
        <a
          href={release?.html_url ?? RELEASES_PAGE}
          className="btn btn-ghost"
          target="_blank"
          rel="noreferrer"
        >
          {t("download.all")} <span aria-hidden>→</span>
        </a>
        <span className="text-[0.82rem] text-white/40">
          {state === "ready" ? `v${version}` : state === "loading" ? "…" : t("download.fallback")}
        </span>
      </div>

      <div className="brand-panel mt-10 flex items-start gap-4 p-5">
        <Terminal size={18} className="mt-0.5 shrink-0 text-brand-mint" />
        <div>
          <h3 className="text-[0.96rem] font-semibold">{t("download.cli.title")}</h3>
          <p className="mt-1 text-[0.86rem] leading-relaxed text-white/54">
            {t("download.cli.body")}
          </p>
          <code className="mt-3 block text-[0.78rem] text-white/72">
            {fr ? "proofcore update --yes" : "proofcore update --yes"}
          </code>
        </div>
      </div>
    </Section>
  );
}

function DownloadCard({
  icon: Icon,
  title,
  subtitle,
  asset,
  loading,
  primary,
  fallback,
  cta,
}: {
  icon: typeof Monitor;
  title: string;
  subtitle: string;
  asset: Asset | null;
  loading: boolean;
  primary?: boolean;
  fallback: string;
  cta: string;
}) {
  const href = asset?.browser_download_url ?? fallback;
  const size = asset ? formatSize(asset.size) : null;
  return (
    <article className="brand-panel flex flex-col p-6">
      <Icon size={22} className="text-brand-mint" />
      <h3 className="mt-4 text-[1.05rem] font-semibold text-white">{title}</h3>
      <p className="mt-1 text-[0.86rem] text-white/54">{subtitle}</p>
      {size ? <p className="mt-1 font-mono text-[0.72rem] text-white/38">{size}</p> : null}
      <div className="mt-6">
        <a
          href={href}
          className={`btn w-full justify-center ${primary ? "btn-primary" : "btn-ghost"}`}
          target="_blank"
          rel="noreferrer"
          aria-busy={loading || undefined}
        >
          <DownloadIcon size={15} />
          {loading ? "…" : cta}
        </a>
      </div>
      {asset ? (
        <p className="mt-3 truncate font-mono text-[0.68rem] text-white/30" title={asset.name}>
          {asset.name}
        </p>
      ) : null}
    </article>
  );
}
