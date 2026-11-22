import { Download as DownloadIcon, Monitor, Package, Terminal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n/index.js";
import { Section, SectionHeading } from "../layouts/BrandLayout.js";
import { apiFetch } from "../lib/api.js";

interface Asset {
  name: string;
  /** Points at this API, never at the release host: the bytes come from our domain. */
  url: string;
  size: number;
  digest: string | null;
}

interface Release {
  tag: string;
  name?: string;
  publishedAt: string;
  prerelease: boolean;
  assets: Asset[];
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const mb = bytes / (1024 * 1024);
  return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

/** The desktop app and the command line ship from one tag: this is what tells them apart. */
function pick(assets: Asset[], desktop: RegExp, cli?: RegExp, bare?: RegExp) {
  const first = (pattern: RegExp) => assets.find((asset) => pattern.test(asset.name)) ?? null;
  return { desktop: first(desktop), cli: cli ? first(cli) : null, bare: bare ? first(bare) : null };
}

function detectPlatform(): "windows" | "macos" | "linux" {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "windows";
  if (ua.includes("mac")) return "macos";
  return "linux";
}

export function DownloadPage() {
  const { t, locale } = useI18n();
  const fr = locale === "fr";
  const [releases, setReleases] = useState<Release[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [mine] = useState(detectPlatform);

  // Every list and every file comes from our own API: the visitor stays on this site, the
  // file keeps our name, and a network that blocks the release host still works.
  useEffect(() => {
    let alive = true;
    apiFetch<{ releases: Release[] }>("/api/v1/releases/versions", { timeoutMs: 12_000 })
      .then((data) => {
        if (!alive) return;
        const list = Array.isArray(data.releases) ? data.releases : [];
        setReleases(list);
        setSelected(list[0]?.tag ?? null);
        setState(list.length > 0 ? "ready" : "empty");
      })
      .catch(() => {
        // A list failure must not hide a download that works: fall back to the latest
        // release, which is the same file the first entry would have offered.
        apiFetch<{ release: Release | null }>("/api/v1/releases/latest", { timeoutMs: 12_000 })
          .then((data) => {
            if (!alive) return;
            if (data.release) {
              setReleases([data.release]);
              setSelected(data.release.tag);
              setState("ready");
            } else {
              setState("error");
            }
          })
          .catch(() => {
            if (alive) setState("error");
          });
      });
    return () => {
      alive = false;
    };
  }, []);

  const release = releases.find((item) => item.tag === selected) ?? releases[0] ?? null;
  const version = release?.tag?.replace(/^v/, "") ?? null;

  const platforms = useMemo(() => {
    const assets = release?.assets ?? [];
    return {
      windows: pick(
        assets,
        /^PROOFCORE-.*\.exe$/i,
        /setup-win-x64\.exe$/i,
        /^proofcore-win-x64\.exe$/i
      ),
      macos: pick(
        assets,
        /^PROOFCORE-.*\.(dmg|zip)$/i,
        /installer-darwin-arm64\.run$/i,
        /^proofcore-darwin-arm64$/i
      ),
      linux: pick(
        assets,
        /^PROOFCORE-.*\.(AppImage|deb)$/i,
        /installer-linux-x64\.run$/i,
        /^proofcore-linux-x64$/i
      ),
    };
  }, [release]);

  return (
    <Section>
      <SectionHeading
        as="h1"
        eyebrow={t("download.eyebrow")}
        title={t("download.title")}
        lede={
          fr
            ? "L'application de bureau pour Windows, macOS et Linux, avec le navigateur intégré, le terminal et les outils de l'assistant. Le fichier se télécharge depuis ce site."
            : "The desktop app for Windows, macOS and Linux, with the embedded browser, terminal and assistant tools. The file downloads from this site."
        }
      />

      <div className="mt-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[0.62rem] tracking-[0.18em] text-white/40">
            {fr ? "VERSION" : "VERSION"}
          </p>
          {releases.length > 1 ? (
            <label className="relative mt-1 block">
              <span className="sr-only">{fr ? "Choisir une version" : "Choose a version"}</span>
              <select
                value={selected ?? ""}
                onChange={(event) => setSelected(event.target.value)}
                className="brand-select"
              >
                {releases.map((item, index) => (
                  <option key={item.tag} value={item.tag}>
                    {item.tag}
                    {index === 0 ? (fr ? " — dernière" : " — latest") : ""}
                    {item.publishedAt ? ` · ${item.publishedAt.slice(0, 10)}` : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="mt-1 font-mono text-[0.92rem] text-white/72">
              {version ? `v${version}` : state === "loading" ? "…" : "—"}
            </p>
          )}
        </div>
        {release?.publishedAt ? (
          <p className="font-mono text-[0.7rem] text-white/40">
            {fr ? "publiée le " : "published "}
            {release.publishedAt.slice(0, 10)}
            {release.prerelease ? (fr ? " · préversion" : " · pre-release") : ""}
          </p>
        ) : null}
      </div>

      {/* minmax(0,1fr): the sha256 names are unbreakable mono strings, and a plain
          1fr track lets the widest child push the column past the viewport. */}
      <div className="mt-6 grid gap-5 lg:grid-cols-[repeat(3,minmax(0,1fr))]">
        <DownloadCard
          icon={Monitor}
          title="Windows"
          subtitle={fr ? "Installateur — aucun prérequis" : "Installer — no prerequisites"}
          asset={platforms.windows.desktop}
          cli={platforms.windows.cli}
          bare={platforms.windows.bare}
          highlighted={mine === "windows"}
          loading={state === "loading"}
          cta={t("download.cta")}
          note={
            fr
              ? "Installe pour l'utilisateur courant, sans élévation. Se met à jour toute seule."
              : "Installs for the current user, no elevation. Updates itself."
          }
        />
        <DownloadCard
          icon={Package}
          title="macOS"
          subtitle={fr ? "Image disque (.dmg)" : "Disk image (.dmg)"}
          asset={platforms.macos.desktop}
          cli={platforms.macos.cli}
          bare={platforms.macos.bare}
          highlighted={mine === "macos"}
          loading={state === "loading"}
          cta={t("download.cta")}
          note={
            fr
              ? "Apple Silicon et Intel. Une image non signée demande un clic droit → Ouvrir au premier lancement."
              : "Apple Silicon and Intel. An unsigned image needs right-click → Open the first time."
          }
        />
        <DownloadCard
          icon={Package}
          title="Linux"
          subtitle={fr ? "AppImage ou paquet Debian" : "AppImage or Debian package"}
          asset={platforms.linux.desktop}
          cli={platforms.linux.cli}
          bare={platforms.linux.bare}
          highlighted={mine === "linux"}
          loading={state === "loading"}
          cta={t("download.cta")}
          note={
            fr
              ? "chmod +x pour l'AppImage, dpkg -i pour le .deb. Se met à jour toute seule."
              : "chmod +x for the AppImage, dpkg -i for the .deb. Updates itself."
          }
        />
      </div>

      <div className="brand-panel mt-10 flex items-start gap-4 p-5">
        <Terminal size={18} className="mt-0.5 shrink-0 text-brand-mint" />
        <div>
          <h3 className="text-[0.96rem] font-semibold">{t("download.cli.title")}</h3>
          <p className="mt-1 text-[0.86rem] leading-relaxed text-white/54">
            {fr
              ? "La même version en ligne de commande, pour les machines sans interface. Elle s'installe en une commande et se met à jour depuis ce site."
              : "The same version on the command line, for machines without a display. One command to install, and it updates from this site."}
          </p>
          <div className="mt-3 grid gap-1.5">
            <code className="block font-mono text-[0.76rem] text-white/72">npm i -g proofcore</code>
            <code className="block font-mono text-[0.72rem] text-white/48">
              {fr
                ? "# si macOS a été installé et que la commande existe déjà :"
                : "# if it is already installed:"}
            </code>
            <code className="block font-mono text-[0.76rem] text-white/72">
              proofcore update --yes
            </code>
            <code className="block font-mono text-[0.72rem] text-white/48">
              {fr
                ? "# ou l'installateur autonome de la colonne de ton système, sans Node installé"
                : "# or the standalone installer in your system's column, with no Node installed"}
            </code>
          </div>
        </div>
      </div>

      {state === "empty" || state === "error" ? (
        <p className="mt-6 text-[0.82rem] text-white/46">
          {state === "error"
            ? fr
              ? "Les versions sont momentanément indisponibles. Rien n'est inventé : réessaie dans une minute, ou installe par npm (commande ci-dessus)."
              : "Releases are temporarily unavailable. Nothing is invented: try again in a minute, or install through npm (command above)."
            : t("download.fallback")}
        </p>
      ) : null}
    </Section>
  );
}

function DownloadCard({
  icon: Icon,
  title,
  subtitle,
  asset,
  cli,
  bare,
  highlighted,
  loading,
  cta,
  note,
}: {
  icon: typeof Monitor;
  title: string;
  subtitle: string;
  asset: Asset | null;
  cli: Asset | null;
  bare: Asset | null;
  highlighted: boolean;
  loading: boolean;
  cta: string;
  note?: string;
}) {
  const size = asset ? formatSize(asset.size) : null;
  return (
    <article
      className={`brand-panel flex min-w-0 flex-col p-6 ${highlighted ? "is-detected" : ""}`}
    >
      <Icon size={22} className="text-brand-mint" />
      <h3 className="mt-4 text-[1.05rem] font-semibold text-white">
        {title}
        {highlighted ? (
          <span className="ml-2 align-middle font-mono text-[0.58rem] tracking-[0.14em] text-brand-mint">
            TON SYSTÈME
          </span>
        ) : null}
      </h3>
      <p className="mt-1 text-[0.86rem] text-white/54">{subtitle}</p>
      {size ? <p className="mt-1 font-mono text-[0.72rem] text-white/38">{size}</p> : null}
      <div className="mt-6">
        {asset ? (
          // A plain link with `download`: the browser saves the file from our own origin.
          // No new tab, no release host, no page to land on.
          <a
            href={asset.url}
            download={asset.name}
            className="btn btn-primary w-full justify-center"
          >
            <DownloadIcon size={15} />
            {cta}
          </a>
        ) : (
          <span className="btn w-full justify-center opacity-50" aria-busy={loading || undefined}>
            <DownloadIcon size={15} />
            {loading ? "…" : "—"}
          </span>
        )}
      </div>
      {note ? <p className="mt-3 text-[0.74rem] leading-relaxed text-white/38">{note}</p> : null}

      <dl className="mt-4 grid gap-1.5 border-t border-white/8 pt-3 font-mono text-[0.68rem] text-white/40">
        {cli ? (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-white/34">CLI</dt>
            <dd className="min-w-0 truncate text-right">
              <a href={cli.url} download={cli.name} className="underline-offset-2 hover:underline">
                {formatSize(cli.size) || cli.name}
              </a>
            </dd>
          </div>
        ) : null}
        {bare ? (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-white/34">
              {bare.name.includes("darwin") ? "binaire" : "binaire"}
            </dt>
            <dd className="min-w-0 truncate text-right">
              <a
                href={bare.url}
                download={bare.name}
                className="underline-offset-2 hover:underline"
              >
                {formatSize(bare.size) || bare.name}
              </a>
            </dd>
          </div>
        ) : null}
      </dl>
      {asset ? (
        <p className="mt-2 truncate font-mono text-[0.64rem] text-white/26" title={asset.name}>
          {asset.name}
        </p>
      ) : null}
    </article>
  );
}
