import {
  ArrowUpRight,
  BadgeCheck,
  Boxes,
  FileBarChart2,
  Globe2,
  Plug,
  Route,
  ShieldAlert,
  Timer,
  Unplug,
} from "lucide-react";
import { Link } from "react-router";
import { useI18n } from "../../i18n/index.js";

/**
 * The module wall: white tiles over a blue→violet→pink→orange field, line icons and small
 * auxiliary chips. Deliberately static — a pointer-following tilt moved the text people
 * were reading, so the composition carries the depth and the content stays still.
 */
export function ModuleShowcase() {
  const { t } = useI18n();

  return (
    <div className="spectrum-field relative overflow-hidden rounded-[28px] px-5 py-12 sm:px-8 lg:py-16">
      <div className="relative mx-auto grid max-w-[1050px] gap-5">
        <div className="grid gap-5 md:grid-cols-3">
          <Tile
            title={t("modules.world.name")}
            subtitle={t("modules.world.tag")}
            body={t("question.world")}
            icon={<Globe2 size={26} className="tile-ink" />}
            to="/world"
            openLabel={t("modules.open")}
          />
          <Tile
            title={t("modules.flow.name")}
            subtitle={t("modules.flow.tag")}
            body={t("question.flow")}
            icon={<Route size={26} className="tile-ink" />}
            to="/flow"
            openLabel={t("modules.open")}
            chip={t("mkt.engine.core")}
          />
          <Tile
            title={t("modules.exit.name")}
            subtitle={t("modules.exit.tag")}
            body={t("question.exit")}
            icon={<Unplug size={26} className="tile-ink" />}
            to="/exit"
            openLabel={t("modules.open")}
          />
        </div>

        {/* The two audits live on the second row: same tiles, real HTTP targets. */}
        <div className="grid gap-5 md:grid-cols-[1fr_1fr_1.4fr]">
          <Tile
            title={t("modules.fail.name")}
            subtitle={t("modules.fail.tag")}
            body={t("question.fail")}
            icon={<ShieldAlert size={26} className="tile-ink" />}
            to="/fail"
            openLabel={t("modules.open")}
          />
          <Tile
            title={t("modules.clean.name")}
            subtitle={t("modules.clean.tag")}
            body={t("question.clean")}
            icon={<BadgeCheck size={26} className="tile-ink" />}
            to="/clean"
            openLabel={t("modules.open")}
          />
          <div className="tile p-5">
            <div className="flex items-start gap-4">
              <span className="tile-chip flex size-11 shrink-0 items-center justify-center">
                <Boxes size={20} className="tile-ink" />
              </span>
              <div>
                <h3 className="text-[1.05rem] font-semibold">{t("mkt.engine.title")}</h3>
                <p className="tile-body mt-1.5 text-[0.88rem] leading-relaxed">
                  {t("mkt.engine.body")}
                </p>
                <div className="mt-4 flex flex-wrap gap-2 font-mono text-[0.72rem] text-[#1b2f77]">
                  {["PENDING", "RUNNING", "PASSED", "FAILED", "WARNING", "SKIPPED", "ERROR"].map(
                    (status) => (
                      <span key={status} className="rounded-md bg-[#eef1f8] px-2 py-1">
                        {status}
                      </span>
                    )
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <MiniTile
            icon={<FileBarChart2 size={18} className="tile-ink" />}
            label={t("mkt.tile.reports")}
            note={t("mkt.tile.reports.note")}
          />
          <MiniTile
            icon={<BadgeCheck size={18} className="tile-ink" />}
            label={t("mkt.tile.validation")}
            note={t("mkt.tile.validation.note")}
          />
          <MiniTile
            icon={<Plug size={18} className="tile-ink" />}
            label={t("mkt.tile.integrations")}
            note={t("mkt.tile.integrations.note")}
          />
          <MiniTile
            icon={<Timer size={18} className="tile-ink" />}
            label={t("mkt.tile.automation")}
            note={t("mkt.tile.automation.note")}
          />
        </div>
      </div>
    </div>
  );
}

function Tile({
  title,
  subtitle,
  body,
  icon,
  to,
  openLabel,
  chip,
  style,
}: {
  title: string;
  subtitle: string;
  body: string;
  icon: React.ReactNode;
  to: string;
  openLabel: string;
  chip?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className="tile p-5" style={style}>
      <div className="flex items-center justify-between">
        <span className="tile-chip flex size-11 items-center justify-center">{icon}</span>
        {chip ? (
          <span className="rounded-full bg-[#eef1f8] px-2.5 py-1 font-mono text-[0.66rem] text-[#1b2f77]">
            {chip}
          </span>
        ) : null}
      </div>
      <h3 className="mt-4 text-[1.15rem] font-semibold tracking-tight">{title}</h3>
      <p className="tile-mono text-[0.78rem] uppercase tracking-[0.14em]">{subtitle}</p>
      <p className="tile-body mt-3 text-[0.86rem] leading-relaxed">{body}</p>
      <Link
        to={to}
        className="tile-link mt-4 inline-flex items-center gap-1.5 text-[0.84rem] font-medium hover:underline"
      >
        {openLabel} <ArrowUpRight size={15} />
      </Link>
    </div>
  );
}

function MiniTile({
  icon,
  label,
  note,
  style,
}: {
  icon: React.ReactNode;
  label: string;
  note: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className="tile flex items-center gap-3 px-4 py-3.5" style={style}>
      <span className="tile-chip flex size-9 shrink-0 items-center justify-center">{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-[0.86rem] font-semibold">{label}</p>
        <p className="tile-mono truncate font-mono text-[0.7rem]">{note}</p>
      </div>
    </div>
  );
}
