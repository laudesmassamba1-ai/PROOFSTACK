/**
 * Display formatting for money and dates.
 *
 * Prices arrive as integer minor units plus a currency. They are never converted to
 * a float before formatting: `Intl.NumberFormat.format` takes a Number, so the digit
 * string is rebuilt exactly and only then handed to the formatter. XOF/XAF have no
 * subunit, which is why the exponent comes from the currency, not from a hardcoded 2.
 */

const CURRENCY_EXPONENT: Record<string, number> = { XOF: 0, XAF: 0, JPY: 0, KRW: 0 };

export function currencyExponent(currency: string): number {
  if (currency in CURRENCY_EXPONENT) return CURRENCY_EXPONENT[currency]!;
  try {
    return (
      new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

export function formatMinor(minor: string, currency: string, locale = "en-US"): string {
  const exponent = currencyExponent(currency);
  const negative = minor.startsWith("-");
  const digits = (negative ? minor.slice(1) : minor).padStart(exponent + 1, "0");
  const whole = exponent === 0 ? digits : digits.slice(0, -exponent);
  const fraction = exponent === 0 ? "" : digits.slice(-exponent);
  const numeric = Number(`${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(numeric);
}

export function formatDate(iso: string | null | undefined, locale = "en-US"): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function formatDay(iso: string | null | undefined, locale = "en-US"): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export function duration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60_000)} min`;
}
