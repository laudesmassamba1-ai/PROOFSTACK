import { Boxes, FileJson, MonitorCog, Terminal } from "lucide-react";
import { useI18n } from "../../i18n/index.js";

/**
 * A structural diagram, not a screenshot. It names the real layers the product
 * uses: a local/CI runner, one scheduler, the five module providers and the shared
 * report formats. No counts or success rates are implied.
 */
export function EngineDiagram() {
  const { t } = useI18n();
  return (
    <div className="engine-frame p-5 sm:p-7" data-dark>
      <div className="relative z-10 grid gap-3">
        <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg border border-brand-mint/20 bg-brand-mint/10 text-brand-mint">
              <Terminal size={17} />
            </span>
            <div>
              <p className="text-[0.82rem] font-medium">CLI · CI</p>
              <p className="font-mono text-[0.67rem] text-white/40">developer machine / runner</p>
            </div>
          </div>
          <span className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-white/30">
            local
          </span>
        </div>

        <div className="ml-6 h-5 border-l border-dashed border-brand-mint/30" />

        <div className="rounded-xl border border-brand-mint/25 bg-brand-mint/[0.07] px-4 py-4">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg bg-brand-mint/12 text-brand-mint">
              <MonitorCog size={17} />
            </span>
            <div>
              <p className="text-[0.86rem] font-medium">{t("mkt.engine.title")}</p>
              <p className="mt-0.5 font-mono text-[0.66rem] text-white/42">
                schedule · timeout · cancel · retry
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {["PENDING", "RUNNING", "PASSED", "FAILED", "WARNING", "SKIPPED", "ERROR"].map(
              (status) => (
                <span
                  key={status}
                  className="rounded border border-white/8 bg-black/20 px-1.5 py-1 font-mono text-[0.6rem] text-white/42"
                >
                  {status}
                </span>
              )
            )}
          </div>
        </div>

        <div className="ml-6 h-5 border-l border-dashed border-white/15" />

        <div className="grid gap-2 sm:grid-cols-5">
          {[
            { label: "WORLD", note: "locales", className: "module-world" },
            { label: "FLOW", note: "journeys", className: "module-flow" },
            { label: "EXIT", note: "round trips", className: "module-exit" },
            { label: "FAIL", note: "exposure", className: "module-fail" },
            { label: "CLEAN", note: "score /100", className: "module-clean" },
          ].map((module) => (
            <div key={module.label} className={`module-card ${module.className} px-3 py-3`}>
              <p className="text-[0.72rem] font-semibold tracking-[0.12em]">{module.label}</p>
              <p className="mt-1 font-mono text-[0.63rem] text-white/38">{module.note}</p>
            </div>
          ))}
        </div>

        <div className="ml-6 h-5 border-l border-dashed border-white/15" />

        <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg border border-white/10 text-white/70">
              <FileJson size={17} />
            </span>
            <div>
              <p className="text-[0.82rem] font-medium">One report</p>
              <p className="font-mono text-[0.67rem] text-white/40">JSON · JUnit · HTML · text</p>
            </div>
          </div>
          <Boxes size={16} className="text-white/25" />
        </div>
      </div>
    </div>
  );
}
