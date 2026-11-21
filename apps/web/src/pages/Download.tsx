import { Download as DownloadIcon, Monitor, Package, Terminal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n/index.js";
import { Section, SectionHeading } from "../layouts/BrandLayout.js";
import { apiFetch } from "../lib/api.js";

const REPO = "laudesmassamba1-ai/PROOFSTACK";
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

interface Asset {
  name: string;
  url: string;
  size: number;
  digest: string | null;
}

interface Release {
  tag: string;
  url: string;
  publishedAt: string;
  prerelease: boolean;
  assets: Asset[];
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const mb = bytes / (1024 * 1024);
  return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

/**
 * What a release actually carries.
 *
 * Two surfaces ship from one tag, and they are different products for different people:
 * a self-contained installer for someone who has no toolchain (`.run`, `setup.exe`,
 * `.deb`), and the bare binary for someone who already has one. The page lists what the
 * release contains instead of what the page wishes it contained — an empty card with a
 * "download" button that lands on a 404 is worse than no card at all.
 */
function pickAssets(assets: Asset[]) {
  const byName = (suffix: string, prefix = "") =>
    assets.find((asset) => asset.name.startsWith(prefix) && asset.name.endsWith(suffix)) ?? null;
  return {
    winSetup: byName("setup-win-x64.exe", "proofcore-"),
    linuxRun: byName("installer-linux-x64.run", "proofcore-"),
    deb: byName(".deb"),
    appImage: byName(".AppImage"),
    winBinary: byName("win-x64.exe", "proofcore-") ?? byName("proofcore-win-x64.exe"),
    linuxBinary: byName("proofcore-linux-x64"),
  };
}

export function DownloadPage() {
  const { t, locale } = useI18n();
  const fr = locale === "fr";
  const [release, setRelease] = useState<Release | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");

  // Read through our own API: the CSV/CSP audit found this page calling api.github.com
  // from the browser, which production blocks and which exposes every visitor to GitHub's
  // unauthenticated rate limit. The Worker caches one answer for everyone.
  useEffect(() => {
    let alive = true;
    apiFetch<{ release: Release | null }>("/api/v1/releases/latest", { timeoutMs: 12_000 })
      .then((data) => {
        if (!alive) return;
        setRelease(data.release);
        setState(data.release ? "ready" : "empty");
      })
      .catch(() => {
        if (alive) setState("error");
      });
    return () => {
      alive = false;
    };
  }, []);

  const picks = useMemo(() => (release ? pickAssets(release.assets) : null), [release]);
  // No hard-coded fallback version: a number that lives in the page drifts from the
  // release it claims to describe. Without a release we say so and link to the page.
  const version = release?.tag?.replace(/^v/, "") ?? null;

  return (
    <Section>
      <SectionHeading
        eyebrow={t("download.eyebrow")}
        title={t("download.title")}
        lede={t("download.lede")}
      />

      {/* minmax(0,1fr): the sha256 names are unbreakable mono strings, and a plain
          1fr track lets the widest child push the column past the viewport. */}
      <div className="mt-10 grid gap-5 lg:grid-cols-[repeat(3,minmax(0,1fr))]">
        <DownloadCard
          icon={Monitor}
          title="Windows"
          subtitle={
            fr
              ? "Installateur autonome — aucun prérequis"
              : "Self-contained installer — no prerequisites"
          }
          asset={picks?.winSetup ?? null}
          loading={state === "loading"}
          primary
          fallback={RELEASES_PAGE}
          cta={t("download.cta")}
          note={
            fr
              ? "Installe pour l'utilisateur courant, sans élévation."
              : "Installs for the current user, no elevation."
          }
        />
        <DownloadCard
          icon={Package}
          title="Linux"
          subtitle={
            fr ? "Installateur .run — aucune dépendance" : ".run installer — no dependencies"
          }
          asset={picks?.linuxRun ?? null}
          loading={state === "loading"}
          fallback={RELEASES_PAGE}
          cta={t("download.cta")}
          note={
            fr
              ? "chmod +x, puis exécuter : ajoute le CLI au PATH."
              : "chmod +x, then run: adds the CLI to PATH."
          }
        />
        <DownloadCard
          icon={Package}
          title="Linux"
          subtitle={fr ? "Paquet Debian (.deb), ou AppImage" : "Debian package (.deb), or AppImage"}
          asset={picks?.deb ?? picks?.appImage ?? null}
          loading={state === "loading"}
          fallback={RELEASES_PAGE}
          cta={t("download.cta")}
          note={
            picks?.appImage
              ? fr
                ? "AppImage également disponible ci-dessous."
                : "AppImage also available below."
              : undefined
          }
        />
      </div>

      {/* The bare binaries: same engine, for machines that already have a toolchain and
          want a file they can hash. */}
      <div className="brand-panel mt-5 grid gap-4 p-5 sm:grid-cols-2">
        <div>
          <p className="font-mono text-[0.62rem] tracking-[0.18em] text-white/40">
            {fr ? "BINAIRES SANS INSTALLEUR" : "BARE BINARIES"}
          </p>
          <p className="mt-1.5 text-[0.84rem] leading-relaxed text-white/52">
            {fr
              ? "Le même moteur, un seul fichier, une empreinte sha256 publiée à côté. Vérifiez avant d'exécuter."
              : "The same engine as one file, with a published sha256 beside it. Verify before you run it."}
          </p>
        </div>
        <div className="flex flex-col gap-2 self-center">
          {[
            { label: "Linux x64", asset: picks?.linuxBinary ?? null },
            { label: "Windows x64", asset: picks?.winBinary ?? null },
          ].map(({ label, asset }) => (
            <a
              key={label}
              href={asset?.url ?? RELEASES_PAGE}
              className="flex items-center justify-between gap-3 rounded-lg border border-white/10 px-3 py-2 font-mono text-[0.72rem] text-white/70 transition-colors hover:border-brand-mint/40 hover:text-white"
              target="_blank"
              rel="noreferrer"
            >
              <span>{label}</span>
              <span className="text-white/36">{asset ? formatSize(asset.size) : "—"}</span>
            </a>
          ))}
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-4">
        <a
          href={release?.url ?? RELEASES_PAGE}
          className="btn btn-ghost"
          target="_blank"
          rel="noreferrer"
        >
          {t("download.all")} <span aria-hidden>→</span>
        </a>
        <span className="text-[0.82rem] text-white/40">
          {version
            ? `v${version}`
            : state === "loading"
              ? "…"
              : state === "error"
                ? fr
                  ? "Versions momentanément indisponibles — la page GitHub reste accessible ci-dessus."
                  : "Versions temporarily unavailable — the GitHub page above still works."
                : fr
                  ? "Aucune version publiée pour l'instant"
                  : t("download.fallback")}
        </span>
      </div>

      <div className="brand-panel mt-10 flex items-start gap-4 p-5">
        <Terminal size={18} className="mt-0.5 shrink-0 text-brand-mint" />
        <div>
          <h3 className="text-[0.96rem] font-semibold">{t("download.cli.title")}</h3>
          <p className="mt-1 text-[0.86rem] leading-relaxed text-white/54">
            {t("download.cli.body")}
          </p>
          {/* Two ways in, because there are two kinds of machine: one with Node and one
              without. Both are real commands, and both are in the release above. */}
          <div className="mt-3 grid gap-1.5">
            <code className="block font-mono text-[0.76rem] text-white/72">npm i -g proofcore</code>
            <code className="block font-mono text-[0.72rem] text-white/48">
              {fr
                ? "# ou : l'installateur autonome ci-dessus, sans Node installé"
                : "# or: the self-contained installer above, with no Node installed"}
            </code>
            <code className="block font-mono text-[0.76rem] text-white/72">
              proofcore update --yes
            </code>
          </div>
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
  note,
}: {
  icon: typeof Monitor;
  title: string;
  subtitle: string;
  asset: Asset | null;
  loading: boolean;
  primary?: boolean;
  fallback: string;
  cta: string;
  note?: string;
}) {
  const href = asset?.url ?? fallback;
  const size = asset ? formatSize(asset.size) : null;
  return (
    <article className="brand-panel flex min-w-0 flex-col p-6">
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
      {note ? <p className="mt-3 text-[0.74rem] leading-relaxed text-white/38">{note}</p> : null}
      {asset ? (
        <div className="mt-2 min-w-0">
          <p className="truncate font-mono text-[0.68rem] text-white/30" title={asset.name}>
            {asset.name}
          </p>
          {asset.digest ? (
            <p className="truncate font-mono text-[0.64rem] text-white/26" title={asset.digest}>
              {asset.digest}
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
