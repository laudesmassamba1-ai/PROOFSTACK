import { ProofstackError } from "./errors.js";

/**
 * Currency metadata.
 *
 * The exponent (ISO 4217 minor units) is *data*, not a guess: XOF and XAF have no
 * subunit, JOD/KWD/BHD/OMR have three decimal digits, everything else in this set
 * has two. Treating every currency as 2-decimal is the single most common money bug
 * in software that claims to be international — which is why PROOFSTACK tests for it.
 *
 * Unknown codes throw instead of defaulting. A silent default would let a wrong
 * amount reach a payment provider.
 */

export interface CurrencyMeta {
  readonly code: string;
  readonly exponent: 0 | 2 | 3;
  readonly name: string;
  /** Locales where this currency is normally used, for formatting tests. */
  readonly locales: readonly string[];
}

const CURRENCIES: readonly CurrencyMeta[] = [
  { code: "XOF", exponent: 0, name: "West African CFA franc", locales: ["fr-BJ", "fr-CG", "fr-SN", "fr-CI"] },
  { code: "XAF", exponent: 0, name: "Central African CFA franc", locales: ["fr-CM", "fr-GA"] },
  { code: "NGN", exponent: 2, name: "Nigerian naira", locales: ["en-NG"] },
  { code: "GHS", exponent: 2, name: "Ghanaian cedi", locales: ["en-GH"] },
  { code: "LRD", exponent: 2, name: "Liberian dollar", locales: ["en-LR"] },
  { code: "GMD", exponent: 2, name: "Dalasi", locales: ["en-GM"] },
  { code: "GNF", exponent: 0, name: "Guinean franc", locales: ["fr-GN"] },
  { code: "MGA", exponent: 2, name: "Malagasy ariary", locales: ["mg-MG"] },
  { code: "XCD", exponent: 2, name: "Eastern Caribbean dollar", locales: ["en-AG"] },
  { code: "USD", exponent: 2, name: "US dollar", locales: ["en-US"] },
  { code: "CAD", exponent: 2, name: "Canadian dollar", locales: ["en-CA", "fr-CA"] },
  { code: "EUR", exponent: 2, name: "Euro", locales: ["fr-FR", "de-DE", "es-ES", "en-IE"] },
  { code: "GBP", exponent: 2, name: "Pound sterling", locales: ["en-GB"] },
  { code: "CHF", exponent: 2, name: "Swiss franc", locales: ["de-CH", "fr-CH"] },
  { code: "SEK", exponent: 2, name: "Swedish krona", locales: ["sv-SE"] },
  { code: "NOK", exponent: 2, name: "Norwegian krone", locales: ["nb-NO"] },
  { code: "DKK", exponent: 2, name: "Danish krone", locales: ["da-DK"] },
  { code: "PLN", exponent: 2, name: "Polish złoty", locales: ["pl-PL"] },
  { code: "CZK", exponent: 2, name: "Czech koruna", locales: ["cs-CZ"] },
  { code: "HUF", exponent: 2, name: "Hungarian forint", locales: ["hu-HU"] },
  { code: "JPY", exponent: 0, name: "Japanese yen", locales: ["ja-JP"] },
  { code: "KRW", exponent: 0, name: "Korean won", locales: ["ko-KR"] },
  { code: "CNY", exponent: 2, name: "Chinese yuan", locales: ["zh-CN"] },
  { code: "INR", exponent: 2, name: "Indian rupee", locales: ["en-IN", "hi-IN"] },
  { code: "BRL", exponent: 2, name: "Brazilian real", locales: ["pt-BR"] },
  { code: "MXN", exponent: 2, name: "Mexican peso", locales: ["es-MX"] },
  { code: "ARS", exponent: 2, name: "Argentine peso", locales: ["es-AR"] },
  { code: "ZAR", exponent: 2, name: "South African rand", locales: ["en-ZA"] },
  { code: "KES", exponent: 2, name: "Kenyan shilling", locales: ["sw-KE"] },
  { code: "TZS", exponent: 2, name: "Tanzanian shilling", locales: ["sw-TZ"] },
  { code: "UGX", exponent: 0, name: "Ugandan shilling", locales: ["en-UG"] },
  { code: "RWF", exponent: 0, name: "Rwandan franc", locales: ["rw-RW"] },
  { code: "MAD", exponent: 2, name: "Moroccan dirham", locales: ["ar-MA", "fr-MA"] },
  { code: "DZD", exponent: 2, name: "Algerian dinar", locales: ["ar-DZ"] },
  { code: "TND", exponent: 3, name: "Tunisian dinar", locales: ["ar-TN"] },
  { code: "EGP", exponent: 2, name: "Egyptian pound", locales: ["ar-EG"] },
  { code: "JOD", exponent: 3, name: "Jordanian dinar", locales: ["ar-JO"] },
  { code: "KWD", exponent: 3, name: "Kuwaiti dinar", locales: ["ar-KW"] },
  { code: "BHD", exponent: 3, name: "Bahraini dinar", locales: ["ar-BH"] },
  { code: "OMR", exponent: 3, name: "Omani rial", locales: ["ar-OM"] },
  { code: "AED", exponent: 2, name: "UAE dirham", locales: ["ar-AE"] },
  { code: "SAR", exponent: 2, name: "Saudi riyal", locales: ["ar-SA"] },
  { code: "TRY", exponent: 2, name: "Turkish lira", locales: ["tr-TR"] },
  { code: "ILS", exponent: 2, name: "Israeli new shekel", locales: ["he-IL"] },
  { code: "AUD", exponent: 2, name: "Australian dollar", locales: ["en-AU"] },
  { code: "NZD", exponent: 2, name: "New Zealand dollar", locales: ["en-NZ"] },
  { code: "SGD", exponent: 2, name: "Singapore dollar", locales: ["en-SG"] },
  { code: "THB", exponent: 2, name: "Thai baht", locales: ["th-TH"] },
  { code: "IDR", exponent: 2, name: "Indonesian rupiah", locales: ["id-ID"] },
  { code: "PHP", exponent: 2, name: "Philippine peso", locales: ["fil-PH"] },
  { code: "VND", exponent: 0, name: "Vietnamese dong", locales: ["vi-VN"] },
  { code: "COP", exponent: 2, name: "Colombian peso", locales: ["es-CO"] },
  { code: "PEN", exponent: 2, name: "Peruvian sol", locales: ["es-PE"] },
  { code: "CLP", exponent: 0, name: "Chilean peso", locales: ["es-CL"] },
  { code: "ISK", exponent: 0, name: "Icelandic króna", locales: ["is-IS"] },
  { code: "MRU", exponent: 2, name: "Mauritanian ouguiya", locales: ["ar-MR"] },
  { code: "CDF", exponent: 2, name: "Congolese franc", locales: ["fr-CD"] },
  { code: "RSD", exponent: 2, name: "Serbian dinar", locales: ["sr-RS"] },
  { code: "UAH", exponent: 2, name: "Ukrainian hryvnia", locales: ["uk-UA"] },
  { code: "RUB", exponent: 2, name: "Russian ruble", locales: ["ru-RU"] },
] as const;

const BY_CODE = new Map<string, CurrencyMeta>(CURRENCIES.map((c) => [c.code, c]));

export function currencyMeta(code: string): CurrencyMeta {
  const upper = code.toUpperCase();
  const meta = BY_CODE.get(upper);
  if (!meta) {
    throw new ProofstackError({
      message: `Unknown currency code ${JSON.stringify(code)}: PROOFSTACK refuses to guess a subunit exponent`,
      category: "VALIDATION",
      code: "unknown_currency",
      details: { code },
    });
  }
  return meta;
}

export function isKnownCurrency(code: string): boolean {
  return BY_CODE.has(code.toUpperCase());
}

export function knownCurrencies(): CurrencyMeta[] {
  return [...CURRENCIES];
}

export function currencyExponent(code: string): 0 | 2 | 3 {
  return currencyMeta(code).exponent;
}
