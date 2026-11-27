import type { LocaleProfileData } from "@proofcore/contracts";
import {
  currencyMeta,
  dstTransitions,
  Money,
  numberSeparators,
  parseLocalizedDecimal,
  resolveWallClock,
  zoneOffsetMs,
} from "@proofcore/core";
import type { CountryCode } from "libphonenumber-js";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { parseJapaneseDate, parseWithAnyPattern, toAsciiDigits } from "./dateformat.js";

export const FIXTURE_CATEGORIES = [
  "identity",
  "phone",
  "email",
  "address",
  "currency",
  "datetime",
  "collation",
] as const;
export type FixtureCategory = (typeof FIXTURE_CATEGORIES)[number];

export interface Fixture {
  id: string;
  profile: string;
  category: FixtureCategory;
  field: string;
  value: string;
  expectation: "accept" | "reject";
  /**
   * What a correct product must end up with: E.164 digits, exact money minor
   * units, an ISO instant, or the submitted text. Absent when only the
   * accept/reject decision is meaningful.
   */
  expected?: string;
  /**
   * `exact` — bytes must match. `nfc` — a NFC-normalised match is equally correct.
   * `digits` — compare the digit/sign sequence only (separators are locale noise).
   */
  tolerance: "exact" | "nfc" | "digits";
  /** `soft` fixtures report a rejection as a warning instead of a failure. */
  strictness: "hard" | "soft";
  /**
   * Additional readings a correct product may legitimately return — used for
   * fall-back overlaps where two instants match the same wall clock.
   */
  alternatives?: string[];
  note?: string;
}

/**
 * A fixture id must identify the fixture, not its position in a run.
 *
 * It used to append a module-level counter, so building the same fixtures twice in one
 * process produced different ids. That broke `--only` (which matches on the id that a
 * previous report printed) and made two runs impossible to diff.
 *
 * The id is now a pure function of the profile, the category and the ordinal *within
 * that group*, passed explicitly by the caller's `push` order. Deterministic, stable
 * across processes, and still readable in a report.
 */
function fixtureId(profile: string, category: string, hint: string): string {
  return `${profile}/${category}/${slug(hint)}`;
}

function slug(value: string): string {
  return (
    toAsciiDigits(value)
      .replace(/[^A-Za-z0-9]+/g, "")
      .slice(0, 12) || "x"
  );
}

export interface BuildOptions {
  categories?: readonly FixtureCategory[];
  /** Cap per (profile, category) so a run stays bounded in CI. */
  maxPerCategory?: number;
}

export function buildFixtures(profile: LocaleProfileData, options: BuildOptions = {}): Fixture[] {
  const categories = new Set<FixtureCategory>(options.categories ?? FIXTURE_CATEGORIES);
  const out: Fixture[] = [];
  const cap = options.maxPerCategory ?? 200;
  // Duplicate base ids (two fixtures with the same hint) are disambiguated by their
  // order within the group, which is deterministic, instead of by a global counter
  // that changed on every call.
  const seenIds = new Map<string, number>();
  const push: Push = (fixture) => {
    const same = out.filter((f) => f.category === fixture.category).length;
    if (same >= cap) return;
    const occurrence = seenIds.get(fixture.id) ?? 0;
    seenIds.set(fixture.id, occurrence + 1);
    out.push(occurrence === 0 ? fixture : { ...fixture, id: `${fixture.id}~${occurrence + 1}` });
  };

  if (categories.has("identity")) identityFixtures(profile, push);
  if (categories.has("phone")) phoneFixtures(profile, push);
  if (categories.has("email")) emailFixtures(profile, push);
  if (categories.has("address")) addressFixtures(profile, push);
  if (categories.has("currency")) currencyFixtures(profile, push);
  if (categories.has("datetime")) datetimeFixtures(profile, push);
  if (categories.has("collation")) collationFixtures(profile, push);

  return out;
}

type Push = (fixture: Fixture) => void;

function identityFixtures(profile: LocaleProfileData, push: Push): void {
  for (const name of profile.fixtures.names) {
    push({
      id: fixtureId(profile.id, "identity", name),
      profile: profile.id,
      category: "identity",
      field: "full_name",
      value: name,
      expectation: "accept",
      expected: name,
      tolerance: "nfc",
      strictness: "hard",
    });
  }
  for (const name of profile.fixtures.difficultNames) {
    push({
      id: fixtureId(profile.id, "identity", name),
      profile: profile.id,
      category: "identity",
      field: "full_name",
      value: name,
      expectation: "accept",
      expected: name,
      tolerance: "nfc",
      strictness: "hard",
      note: "accented, non-Latin, long or mixed-script display name",
    });
  }
  // Combining sequence typed as base + mark: must survive as the same name.
  push({
    id: fixtureId(profile.id, "identity", "combining"),
    profile: profile.id,
    category: "identity",
    field: "full_name",
    value: "e\u0301lodie",
    expectation: "accept",
    expected: "élodie",
    tolerance: "nfc",
    strictness: "hard",
    note: "decomposed input; NFC storage is correct, mojibake or loss is not",
  });

  const nul = String.fromCharCode(0);
  const us = String.fromCharCode(31);
  const mustReject: Array<[string, string]> = [
    ["", "an empty name must not become a person record"],
    ["   ", "a whitespace-only name must be rejected, not trimmed into a record"],
    [`${nul}${us}`, "control characters must never be stored"],
    ["a\u202ebc", "a bidi override inside a display name must be rejected or sanitised"],
  ];
  for (const [value, note] of mustReject) {
    push({
      id: fixtureId(profile.id, "identity", `reject-${slug(value)}`),
      profile: profile.id,
      category: "identity",
      field: "full_name",
      value,
      expectation: "reject",
      tolerance: "exact",
      strictness: "hard",
      note,
    });
  }
}

/**
 * Email is the identity field every signup form has, and the one most often narrowed
 * by a regex written for ASCII. The hard cases are valid addresses a naive pattern
 * refuses: a plus tag, an apostrophe, a long TLD, a quoted local part and SMTPUTF8.
 * Rejection of the soft cases is a warning, not a failure, because browser and SMTP
 * support varies; rejection of the plain cases is a defect.
 */
function emailFixtures(profile: LocaleProfileData, push: Push): void {
  const valid = [
    "avery.smith@example.com",
    "lucie+facture@example.com",
    "o'brien@example.com",
    "x@example.photography",
  ];
  for (const value of valid) {
    push({
      id: fixtureId(profile.id, "email", value),
      profile: profile.id,
      category: "email",
      field: "email",
      value,
      expectation: "accept",
      expected: value,
      tolerance: "nfc",
      strictness: "hard",
      note: "a valid address a narrow ASCII pattern often refuses",
    });
  }

  const soft = [
    {
      value: "用户@例子.广告",
      note: "SMTPUTF8 address; rejection is a documented limitation, not silent corruption",
    },
    {
      value: '"quoted name"@example.com',
      note: "quoted local part is valid RFC 5321; normalising it away must not lose the address",
    },
  ];
  for (const item of soft) {
    push({
      id: fixtureId(profile.id, "email", item.value),
      profile: profile.id,
      category: "email",
      field: "email",
      value: item.value,
      expectation: "accept",
      tolerance: "nfc",
      strictness: "soft",
      note: item.note,
    });
  }

  const nul = String.fromCharCode(0);
  const tooLongLocal = `${"a".repeat(65)}@example.com`;
  const tooLongLabel = `a@${"b".repeat(64)}.com`;
  const tooLong = `${"a".repeat(64)}@${"b".repeat(190)}.com`;
  const invalid: Array<[string, string]> = [
    ["plainaddress", "no @, so it cannot be routed"],
    ["a@b", "a domain with no dot is not a public mailbox"],
    [".a@example.com", "the local part cannot start with a dot"],
    ["a..b@example.com", "two consecutive dots are not a valid local part"],
    ["a@-example.com", "a domain label cannot start with a hyphen"],
    ["a@example..com", "an empty domain label is invalid"],
    [tooLongLocal, "the local part exceeds 64 octets"],
    [tooLongLabel, "a domain label exceeds 63 octets"],
    [tooLong, "the whole address exceeds 254 octets"],
    ["a@@example.com", "two @ signs cannot be parsed"],
    ["a@example.com\nBcc: x@example.com", "a newline injects a second header"],
    [`a${nul}b@example.com`, "a NUL byte must never be stored in an address"],
    ["a\u202eb@example.com", "a bidi override inside an address must be rejected or sanitised"],
  ];
  for (const [value, note] of invalid) {
    push({
      id: fixtureId(profile.id, "email", value),
      profile: profile.id,
      category: "email",
      field: "email",
      value,
      expectation: "reject",
      tolerance: "exact",
      strictness: "hard",
      note,
    });
  }
}

function phoneFixtures(profile: LocaleProfileData, push: Push): void {
  for (const value of profile.fixtures.phones) {
    const parsed = parsePhoneNumberFromString(value, profile.country as CountryCode);
    if (!parsed?.isValid()) {
      // A profile that ships an invalid "valid" number is a PROOFCORE bug, not a
      // product bug: surface it instead of testing nonsense.
      push({
        id: fixtureId(profile.id, "phone", `metadata-${slug(value)}`),
        profile: profile.id,
        category: "phone",
        field: "phone",
        value,
        expectation: "reject",
        tolerance: "digits",
        strictness: "hard",
        note: `profile fixture rejected by libphonenumber metadata for ${profile.country}`,
      });
      continue;
    }
    push({
      id: fixtureId(profile.id, "phone", `valid-${slug(value)}`),
      profile: profile.id,
      category: "phone",
      field: "phone",
      value,
      expectation: "accept",
      expected: parsed.number,
      tolerance: "digits",
      strictness: "hard",
      note: `national form ${parsed.formatNational()}`,
    });
  }
  for (const value of profile.fixtures.invalidPhones) {
    const parsed = parsePhoneNumberFromString(value, profile.country as CountryCode);
    push({
      id: fixtureId(profile.id, "phone", `invalid-${slug(value)}`),
      profile: profile.id,
      category: "phone",
      field: "phone",
      value,
      expectation: "reject",
      tolerance: "digits",
      strictness: "hard",
      note: parsed?.isValid()
        ? "metadata says valid; profile declares it invalid"
        : "must not be accepted",
    });
  }
}

function addressFixtures(profile: LocaleProfileData, push: Push): void {
  for (const value of profile.fixtures.addresses) {
    push({
      id: fixtureId(profile.id, "address", slug(value)),
      profile: profile.id,
      category: "address",
      field: "address_line1",
      value,
      expectation: "accept",
      expected: value,
      tolerance: "nfc",
      strictness: "hard",
    });
  }
  // A 300-character address is legitimate for a farm with a landmark description.
  // Rejection is a warning; silent truncation is a failure.
  const long = `${profile.fixtures.addresses[0] ?? "1 Main St"}, `
    .repeat(1)
    .concat("Apt ".repeat(1) + "x".repeat(280));
  push({
    id: fixtureId(profile.id, "address", "long"),
    profile: profile.id,
    category: "address",
    field: "address_line1",
    value: long,
    expectation: "accept",
    expected: long,
    tolerance: "nfc",
    strictness: "soft",
    note: "long address: a documented limit is acceptable, silent truncation is not",
  });

  for (const code of profile.fixtures.postalCodes) {
    const matches =
      profile.address.postalCode.pattern.length === 0
        ? true
        : new RegExp(profile.address.postalCode.pattern).test(code);
    push({
      id: fixtureId(profile.id, "address", `postal-${slug(code)}`),
      profile: profile.id,
      category: "address",
      field: "postal_code",
      value: code,
      expectation: matches ? "accept" : "reject",
      expected: matches ? code : undefined,
      tolerance: "exact",
      strictness: "hard",
      note: `pattern ${profile.address.postalCode.pattern || "(no postal system)"}`,
    });
  }

  // The empty-postcode rule is where forms for countries without postal codes break.
  push({
    id: fixtureId(profile.id, "address", "postal-empty"),
    profile: profile.id,
    category: "address",
    field: "postal_code",
    value: "",
    expectation: profile.address.postalCode.required ? "reject" : "accept",
    tolerance: "exact",
    strictness: "hard",
    note: profile.address.postalCode.required
      ? "this country does use postcodes, so an empty one should be refused"
      : "this country has no postal code system: requiring one is a defect",
  });
}

function currencyFixtures(profile: LocaleProfileData, push: Push): void {
  const code = profile.currency;
  const meta = currencyMeta(code);
  const separators = numberSeparators(profile.id);

  const declare = (
    value: string,
    expected: string | undefined,
    note: string,
    strictness: "hard" | "soft" = "hard"
  ): void => {
    push({
      id: fixtureId(profile.id, "currency", slug(value)),
      profile: profile.id,
      category: "currency",
      field: "amount",
      value,
      expectation: expected === undefined ? "reject" : "accept",
      expected,
      tolerance: "digits",
      strictness,
      note,
    });
  };

  const minor = (major: string): string =>
    Money.fromDecimalString(major, code, { exact: true }).minor.toString();

  /**
   * An amount with the currency's own number of decimals.
   *
   * XOF/XAF have exponent 0, so "1234.50" is not a representable amount for them —
   * asking `minor()` for it throws, and building the fixture set must not throw. This
   * helper picks a value the currency can actually hold, so the fixture set is valid
   * for every profile instead of only the two-decimal ones.
   */
  const amountWith = (whole: string, fraction: string): string =>
    meta.exponent === 0
      ? whole
      : `${whole}.${fraction.slice(0, meta.exponent).padEnd(meta.exponent, "0")}`;

  // 1. Exactly what the product's own locale would render.
  const rendered = new Intl.NumberFormat(profile.id, {
    style: "currency",
    currency: code,
    minimumFractionDigits: meta.exponent,
    maximumFractionDigits: meta.exponent,
  }).format(1234.5);
  // The expected value is the *rendered* string parsed back, so it is always
  // representable in this currency by construction.
  const renderedExpected = parseLocalizedDecimal(rendered, separators, code);
  declare(
    rendered,
    renderedExpected.ok ? renderedExpected.money.minor.toString() : minor(amountWith("1234", "50")),
    `rendered by Intl for ${profile.id}; the product must read back its own output`
  );

  // 2. Plain decimal with the locale separators.
  declare(amountWith("1234", "56"), minor(amountWith("1234", "56")), "machine decimal form");
  declare(
    `${"1"}${separators.groupingSeparator || ""}${separators.decimalSeparator === "." ? "" : "234"}${meta.exponent === 0 ? "" : `${separators.decimalSeparator}56`}`,
    minor(amountWith("1234", "56")),
    `locale-separated input (${profile.id})`,
    "soft"
  );

  // 3. Boundaries that expose float arithmetic.
  declare(amountWith("0", "10"), minor(amountWith("0", "10")), "the 0.1 + 0.2 class of bug");
  declare(amountWith("-45", "00"), minor(amountWith("-45", "00")), "negative amount");
  declare(
    amountWith("999999999999999999", "99"),
    minor(amountWith("999999999999999999", "99")),
    "beyond Number.MAX_SAFE_INTEGER: float parsing loses digits"
  );
  declare("0", minor("0"), "zero is a valid amount");

  // 4. Sub-minor precision must be refused, never silently rounded.
  const tooPrecise = meta.exponent === 0 ? "1000.50" : meta.exponent === 2 ? "1.0055" : "1.0005";
  declare(
    tooPrecise,
    undefined,
    `${code} has ${meta.exponent} decimal digit(s); ${tooPrecise} cannot be represented`
  );

  // 5. Garbage must be garbage.
  for (const [value, note] of [
    ["12a", "letters inside an amount"],
    ["--12", "double sign"],
    [
      "1,234",
      separators.groupingSeparator === ","
        ? "grouping without decimals is valid; kept as accept below"
        : `grouping separator for ${profile.id} is not ","`,
    ],
  ] as Array<[string, string]>) {
    const parseable = parseLocalizedDecimal(value, separators, code);
    declare(value, parseable.ok ? parseable.money.minor.toString() : undefined, note);
  }
}

function datetimeFixtures(profile: LocaleProfileData, push: Push): void {
  const zone = profile.timeZones[0] as string;

  const emit = (
    value: string,
    instant: string | undefined,
    note: string,
    strictness: "hard" | "soft" = "hard",
    alternatives?: string[]
  ): void => {
    push({
      id: fixtureId(profile.id, "datetime", slug(value)),
      profile: profile.id,
      category: "datetime",
      field: "event_date",
      value,
      expectation: instant === undefined ? "reject" : "accept",
      expected: instant,
      tolerance: "digits",
      strictness,
      ...(alternatives === undefined ? {} : { alternatives }),
      note,
    });
  };

  for (const sample of profile.fixtures.dateSamples) {
    const parsed =
      parseWithAnyPattern(sample, profile.dateFormats.input) ??
      (profile.language === "ja" ? parseJapaneseDate(sample) : undefined);
    if (!parsed) {
      emit(
        sample,
        undefined,
        `matches none of the declared input formats: ${profile.dateFormats.input.join(", ")}`
      );
      continue;
    }
    const resolution = resolveWallClock(zone, parsed.wall);
    if (resolution.kind === "nonexistent") {
      emit(
        sample,
        new Date(resolution.nearestAfter).toISOString(),
        `wall time ${sample} does not exist in ${zone} (spring-forward gap); the canonical reading is the shifted instant`,
        "soft"
      );
      continue;
    }
    if (resolution.kind === "ambiguous") {
      emit(
        sample,
        new Date(resolution.instants[0] as number).toISOString(),
        `wall time ${sample} happens twice in ${zone} (fall-back overlap); either reading is defensible, so both are accepted`,
        "soft",
        resolution.instants.map((ms) => new Date(ms).toISOString())
      );
      continue;
    }
    emit(sample, new Date(resolution.instant).toISOString(), `midnight in ${zone}`);
  }

  // Calendar-impossible dates: the classic Date.parse rollover.
  emit("30/02/2026", undefined, "30 February does not exist");
  emit("31/04/2026", undefined, "April has 30 days");
  emit("2026-02-29", undefined, "2026 is not a leap year");
  emit("2028-02-29", new Date(Date.UTC(2028, 1, 29, 0, 0)).toISOString(), "2028 is a leap year");

  // A DST transition inside the profile's own zone.
  const gap = dstGapSample(profile, zone);
  if (gap) emit(gap.value, gap.instant, gap.note, "soft");
}

/**
 * Build a wall time that falls in the spring-forward gap of the profile zone, when
 * the zone observes DST at all.
 */
function dstGapSample(
  profile: LocaleProfileData,
  zone: string
): { value: string; instant: string; note: string } | undefined {
  const year = 2026;
  // Find the actual transitions once, instead of probing every day/hour with a full
  // offset sweep. The old loop made a starter `test` spend ~50s in fixture generation.
  for (const transition of dstTransitions(zone, year, year)) {
    const before = zoneOffsetMs(zone, transition - 1);
    const after = zoneOffsetMs(zone, transition);
    if (after <= before) continue; // fall-back overlap, not the spring gap

    const gapStart = transition + before;
    const gapEnd = transition + after;
    const midpoint = gapStart + Math.min(30 * 60_000, Math.floor((gapEnd - gapStart) / 2));
    const wall = new Date(midpoint);
    const padded = (n: number): string => String(n).padStart(2, "0");
    const month = wall.getUTCMonth() + 1;
    const day = wall.getUTCDate();
    const value =
      profile.id === "en-US"
        ? `${padded(month)}/${padded(day)}/${year} ${padded(wall.getUTCHours())}:${padded(wall.getUTCMinutes())}`
        : `${padded(day)}/${padded(month)}/${year} ${padded(wall.getUTCHours())}:${padded(wall.getUTCMinutes())}`;
    return {
      value,
      instant: new Date(transition).toISOString(),
      note: `${value} local time is inside the ${zone} spring-forward gap`,
    };
  }
  return undefined;
}

function collationFixtures(profile: LocaleProfileData, push: Push): void {
  for (const sample of profile.collationSamples) {
    push({
      id: fixtureId(profile.id, "collation", `${slug(sample.a)}-${slug(sample.b)}`),
      profile: profile.id,
      category: "collation",
      field: "full_name",
      value: `${sample.a}|${sample.b}`,
      expectation: "accept",
      expected: sample.expected,
      tolerance: "exact",
      strictness: "hard",
      note: `Intl collation for ${profile.id} says "${sample.a}" ${sample.expected} "${sample.b}"`,
    });
  }
}

/** Human summary used by `proofcore doctor` and the CLI report header. */
export function fixtureSummary(fixtures: readonly Fixture[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const fixture of fixtures) {
    out[`${fixture.profile}:${fixture.category}`] =
      (out[`${fixture.profile}:${fixture.category}`] ?? 0) + 1;
  }
  return out;
}
