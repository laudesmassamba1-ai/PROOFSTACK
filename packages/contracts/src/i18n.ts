import { z } from "zod";
import { localeProfileSchema } from "./config.js";

/**
 * WORLD locale profiles.
 *
 * A profile is *test data*, not a claim of national coverage: eight profiles are
 * shipped, each versioned and extensible, and the schema refuses fixture keys that
 * would look like national identity numbers. PROOFSTACK must never generate real
 * personal records, so the prohibition is enforced by the contract, not by a note
 * in a README.
 */

export const PROFILE_SET_VERSION = 1;

const FORBIDDEN_FIXTURE_KEYS = /(national_?id|identity_?number|ssn|nin|bvn|cni|cin|passport|drivers?_?license|tax_?id|vat_?number|bank_?account|card_?number|iban)/i;

export const addressFormatSchema = z
  .object({
    lines: z.number().int().min(1).max(4).default(2),
    /** Ordered field labels as the country normally writes them. */
    order: z.array(z.string()).default(["street", "extra", "postal", "city", "country"]),
    postalCode: z
      .object({
        pattern: z.string(),
        required: z.boolean(),
        /** Postal codes that are alphanumeric, or absent entirely, in this country. */
        examples: z.array(z.string()).default([]),
      })
      .strict(),
  })
  .strict();
export type AddressFormat = z.infer<typeof addressFormatSchema>;

export const localeProfileSchemaData = z
  .object({
    id: localeProfileSchema,
    version: z.number().int().positive().default(PROFILE_SET_VERSION),
    language: z.string().min(2),
    country: z.string().length(2),
    /** Display name of the region, for reports. */
    region: z.string().min(1),
    script: z.enum(["Latin", "Arabic", "Han", "Kana", "Hangul", "Cyrillic", "Devanagari", "Thai"]),
    direction: z.enum(["ltr", "rtl"]),
    timeZones: z.array(z.string()).min(1),
    currency: z.string().length(3),
    /** E.164 dial prefix for the country, e.g. "+229" for Benin. */
    phoneCountryCode: z.string().regex(/^\+\d{1,3}$/),
    /** Whether the national format keeps a leading zero (Benin: no, France: yes). */
    nationalLeadingZero: z.boolean().default(true),
    nameOrder: z.enum(["given-first", "family-first"]),
    address: addressFormatSchema,
    dateFormats: z
      .object({
        short: z.string(),
        long: z.string(),
        /** Pattern the product is expected to accept on input. */
        input: z.array(z.string()).min(1),
      })
      .strict(),
    weekStartsOn: z.number().int().min(0).max(6).default(1),
    /** Collation-sensitive pairs that must sort in the documented order. */
    collationSamples: z
      .array(z.object({ a: z.string(), b: z.string(), expected: z.enum(["lt", "gt", "eq"]) }).strict())
      .default([]),
    fixtures: z
      .object({
        names: z.array(z.string()).min(1),
        /** Names that must NOT be rejected: long, accented, multi-surname, non-Latin. */
        difficultNames: z.array(z.string()).min(1),
        phones: z.array(z.string()).min(1),
        invalidPhones: z.array(z.string()).min(1),
        addresses: z.array(z.string()).min(1),
        postalCodes: z.array(z.string()).min(1),
        amounts: z.array(z.string()).min(1),
        dateSamples: z.array(z.string()).min(1),
      })
      .strict()
      .refine((value) => {
        const keys = Object.keys(value);
        return keys.every((k) => !FORBIDDEN_FIXTURE_KEYS.test(k));
      }, "locale profiles must not carry identity-number fixtures"),
    /** Anything a profile author knows is incomplete about this profile. */
    limitations: z.array(z.string()).default([]),
    notes: z.string().default(""),
  })
  .strict();
export type LocaleProfileData = z.infer<typeof localeProfileSchemaData>;

export const localeProfileFileSchema = z
  .object({
    version: z.number().int().positive(),
    profiles: z.array(localeProfileSchemaData).min(1),
  })
  .strict();
export type LocaleProfileFile = z.infer<typeof localeProfileFileSchema>;

/** PROOFSTACK's own UI languages. Kept separate from WORLD test profiles. */
export const UI_LOCALES = ["en", "fr"] as const;
export type UiLocale = (typeof UI_LOCALES)[number];

export const DEFAULT_UI_LOCALE: UiLocale = "en";

export function normalizeUiLocale(input: string | undefined | null): UiLocale {
  if (!input) return DEFAULT_UI_LOCALE;
  const base = input.toLowerCase().split("-")[0];
  return UI_LOCALES.includes(base as UiLocale) ? (base as UiLocale) : DEFAULT_UI_LOCALE;
}
