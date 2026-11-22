/**
 * The mobile DA switch. The split comparer is a two-pane spectacle that needs
 * width; on a phone the visitor just wants the other direction — one button,
 * one tap, the whole site flips and the choice is remembered like a commit.
 * CSS keeps it off desktop, where the comparer owns the switch.
 */
import { useI18n } from "../../i18n/index.js";
import { type DAMode, rememberDAMode, useDAMode } from "../../lib/da.js";

export function DaToggleChip() {
  const { t, locale } = useI18n();
  const da = useDAMode();
  const next: DAMode = da === "dark" ? "light" : "dark";

  const flip = (): void => {
    rememberDAMode(next);
    // the storage event is cross-tab only; tell this document too
    window.dispatchEvent(new Event("da-changed"));
  };

  return (
    <button
      type="button"
      className="da-toggle"
      onClick={flip}
      aria-label={t("da.toggle")}
      title={t("da.toggle")}
    >
      ◐{" "}
      {next === "light"
        ? locale === "fr"
          ? "Papier"
          : "Paper"
        : locale === "fr"
          ? "Noir"
          : "Black"}
    </button>
  );
}
