import type { LocaleProfileData, ProofstackConfig } from "@proofstack/contracts";
import {
  Money,
  currencyMeta,
  detectScripts,
  graphemeLength,
  numberSeparators,
  parseLocalizedDecimal,
  resolveWallClock,
  textDirection,
  unicodeEquals,
} from "@proofstack/core";
import type { TestSuiteDef, TestCaseDef } from "@proofstack/engine";
import { buildFixtures, type Fixture, type FixtureCategory } from "./fixtures.js";
import type { ProductFields, ProductUnderTest } from "./harness.js";
import { parseWithAnyPattern, toAsciiDigits } from "./dateformat.js";

/**
 * WORLD checks.
 *
 * Each fixture becomes one case, so a report names the exact value that broke
 * rather than "the identity suite failed". Two independent properties are tested
 * for every accepted submission:
 *   1. the decision (accept what must be accepted, refuse what must be refused);
 *   2. the storage (what came back is what went in, or a documented normalisation).
 * Property 2 is what catches corruption: a product that accepts "Kòfí" and stores
 * "Kof?" passes every acceptance test and still loses the customer's name.
 */

export interface WorldCheckOptions {
  config: ProofstackConfig;
  profiles: LocaleProfileData[];
  target?: ProductUnderTest;
  categories?: readonly FixtureCategory[];
  maxPerCategory?: number;
  /** Narrow to specific fixture ids (`--only`). */
  only?: readonly string[];
}

export function buildWorldSuites(options: WorldCheckOptions): TestSuiteDef[] {
  const suites: TestSuiteDef[] = [];
  for (const profile of options.profiles) {
    const fixtures = buildFixtures(profile, {
      ...(options.categories === undefined ? {} : { categories: options.categories }),
      ...(options.maxPerCategory === undefined ? {} : { maxPerCategory: options.maxPerCategory }),
    });
    const cases: TestCaseDef[] = fixtures
      .filter((f) => (options.only && options.only.length > 0 ? matchesOnly(f, options.only) : true))
      .map((fixture) => worldCase(fixture, profile, options));

    suites.push({
      id: `world:${profile.id}`,
      name: `WORLD — ${profile.id} (${profile.region})`,
      module: "world",
      description: `${fixtures.length} international compatibility checks for ${profile.region}`,
      cases,
    });
  }
  return suites;
}

function matchesOnly(fixture: Fixture, only: readonly string[]): boolean {
  return only.some((pattern) => fixture.id.includes(pattern) || fixture.profile === pattern || fixture.category === pattern);
}

function worldCase(fixture: Fixture, profile: LocaleProfileData, options: WorldCheckOptions): TestCaseDef {
  const target = options.target;
  return {
    id: fixture.id,
    name: `${fixture.category}: ${preview(fixture.value)}`,
    description: describe(fixture, profile),
    module: "world",
    severity: severityFor(fixture),
    suiteId: `world:${profile.id}`,
    profile: profile.id,
    skip: target === undefined ? 'no product target configured (modules.world.target.kind is "none")' : undefined,
    execute: async (ctx) => {
      if (!target) return; // unreachable: the case is skipped

      if (fixture.category === "collation") {
        await collationCase(fixture, profile, target, ctx);
        return;
      }

      const verdict = await target.submit({
        profile: profile.id,
        category: fixture.category,
        fields: { [fixture.field]: fixture.value },
        idempotencyKey: fixture.id,
      });

      const errors = verdict.errors ? JSON.stringify(verdict.errors) : "none";
      await ctx.attachText({
        label: `submit verdict for ${fixture.field}`,
        kind: "payload",
        mediaType: "application/json",
        text: JSON.stringify({ sent: fixture.value, accepted: verdict.accepted, errors: verdict.errors, stored: verdict.stored }),
      });

      if (fixture.expectation === "accept") {
        if (!verdict.accepted && fixture.strictness === "soft") {
          ctx.warn({
            title: `${fixture.field} refused a value the product should tolerate`,
            detail: `${preview(fixture.value)} was rejected (${errors}). ${fixture.note ?? ""}`,
            severity: "MEDIUM",
            field: fixture.field,
            locale: profile.id,
            country: profile.country,
            code: "invalid_rejection",
          });
          ctx.check(true, { description: `documented limit on ${fixture.field}` });
          return;
        }
        ctx.check(verdict.accepted, {
          description: `${profile.id} accepts ${fixture.field}`,
          expected: "accepted",
          actual: verdict.accepted ? "accepted" : `rejected: ${errors}`,
          target: fixture.field,
          code: "invalid_rejection",
          detail: fixture.note,
        });
      } else {
        ctx.check(!verdict.accepted, {
          description: `${profile.id} refuses invalid ${fixture.field}`,
          expected: "rejected",
          actual: `accepted (http ${verdict.httpStatus ?? "n/a"})`,
          target: fixture.field,
          code: "accepts_invalid_value",
          detail: fixture.note,
        });
        return;
      }

      if (fixture.expected === undefined) return;
      const stored = await resolveStored(target, verdict.stored, verdict.recordId, fixture.field);
      if (stored === undefined) {
        ctx.warn({
          title: `${fixture.field}: product did not report what it stored`,
          detail: `the submission was accepted but neither an echo nor a readable record came back, so ${profile.id} integrity could not be verified`,
          severity: "LOW",
          field: fixture.field,
          locale: profile.id,
          code: "storage_unobservable",
        });
        return;
      }

      const comparison = compareStored(fixture, profile, stored);
      ctx.check(comparison.equal, {
        description: `${profile.id} stores ${fixture.field} without loss`,
        expected: preview(fixture.expected),
        actual: preview(comparison.rendered ?? stored),
        target: fixture.field,
        code: "corrupted_transformation",
        detail: comparison.explanation,
      });

      if (fixture.category === "identity" && /\p{C}/u.test(fixture.value) === false) {
        // Grapheme-preserving checks that are independent of the product's answer.
        const expectedLen = graphemeLength(fixture.value);
        const storedLen = graphemeLength(stored);
        if (expectedLen !== storedLen) {
          ctx.report({
            title: `${fixture.field} changed length under ${profile.id}`,
            detail: `submitted ${expectedLen} graphemes, stored ${storedLen}; a truncation this short is usually a column limit`,
            severity: storedLen < expectedLen ? "HIGH" : "MEDIUM",
            field: fixture.field,
            locale: profile.id,
            country: profile.country,
            code: "silent_truncation",
          });
        }
      }
    },
  };
}

async function collationCase(
  fixture: Fixture,
  profile: LocaleProfileData,
  target: ProductUnderTest,
  ctx: import("@proofstack/engine").TestContext,
): Promise<void> {
  if (!target.capabilities.sorted || !target.sorted) {
    ctx.skip("the product exposes no sort endpoint, so collation cannot be observed (capabilities.sorted=false)");
    return;
  }
  const [a, b] = fixture.value.split("|");
  const sorted = await target.sorted({ profile: profile.id, field: fixture.field, values: [b as string, a as string] });
  const indexA = sorted.indexOf(a as string);
  const indexB = sorted.indexOf(b as string);
  const observed = indexA === -1 || indexB === -1 ? "missing" : indexA < indexB ? "lt" : indexA > indexB ? "gt" : "eq";
  ctx.check(observed === fixture.expected, {
    description: `${profile.id} collates "${a}" vs "${b}"`,
    expected: fixture.expected,
    actual: observed,
    target: fixture.field,
    code: "wrong_collation",
    detail: fixture.note,
  });
}

async function resolveStored(
  target: ProductUnderTest,
  echoed: ProductFields | undefined,
  recordId: string | undefined,
  field: string,
): Promise<string | undefined> {
  if (echoed && typeof echoed[field] === "string") return echoed[field];
  if (recordId && target.readback) {
    const record = await target.readback(recordId);
    if (record && typeof record[field] === "string") return record[field];
  }
  return undefined;
}

interface Comparison {
  equal: boolean;
  rendered?: string;
  explanation?: string;
}

function compareStored(fixture: Fixture, profile: LocaleProfileData, stored: string): Comparison {
  switch (fixture.tolerance) {
    case "exact":
      return { equal: stored === fixture.expected };
    case "nfc":
      return {
        equal: unicodeEquals(stored, fixture.expected ?? ""),
        explanation:
          detectScripts(stored).join(",") !== detectScripts(fixture.expected ?? "").join(",")
            ? `script changed: submitted [${detectScripts(fixture.expected ?? "").join(",")}], stored [${detectScripts(stored).join(",")}]`
            : `direction changed: submitted ${textDirection(fixture.expected ?? "")}, stored ${textDirection(stored)}`,
      };
    case "digits":
      if (fixture.category === "currency") return compareAmount(stored, fixture.expected as string, profile);
      if (fixture.category === "datetime") return compareInstant(stored, fixture, profile);
      return compareDigits(stored, fixture.expected as string);
    default:
      return { equal: false, explanation: `unknown fixture tolerance: ${String(fixture.tolerance)}` };
  }
}

function compareDigits(stored: string, expected: string): Comparison {
  const norm = (value: string): string => toAsciiDigits(value).replace(/[^+\d]/g, "");
  const a = norm(stored);
  const b = norm(expected);
  return {
    equal: a === b,
    rendered: a,
    explanation:
      a === b
        ? undefined
        : `digits differ: expected ${b} (E.164), stored ${a}. A dropped leading zero or an unprefixed country code breaks dialling`,
  };
}

function compareAmount(stored: string, expectedMinor: string, profile: LocaleProfileData): Comparison {
  const separators = numberSeparators(profile.id);
  const code = profile.currency;
  const candidates = [
    parseLocalizedDecimal(stored, separators, code),
    parseLocalizedDecimal(stored, { decimalSeparator: ".", groupingSeparator: "," }, code),
    parseLocalizedDecimal(stored, { decimalSeparator: ",", groupingSeparator: "." }, code),
  ];
  for (const candidate of candidates) {
    if (candidate.ok && candidate.money.minor.toString() === expectedMinor) return { equal: true };
  }
  const readable = candidates.find((c) => c.ok);
  return {
    equal: false,
    rendered: readable ? readable.money.toDecimalString() : stored,
    explanation: readable
      ? `stored as ${readable.money.toDecimalString()} ${code}, which is ${diffDescription(readable.money, expectedMinor, code)}`
      : `stored value "${preview(stored)}" cannot be read as a ${code} amount in ${profile.id} or in machine form; a value the suite cannot parse is not portable`,
  };
}

function diffDescription(money: Money, expectedMinor: string, code: string): string {
  const expected = Money.of(code, BigInt(expectedMinor));
  const delta = money.minor - expected.minor;
  if (delta === 0n) return "the same amount";
  const sign = delta > 0n ? "more" : "less";
  return `${(delta < 0n ? -delta : delta).toString()} minor units ${sign} than expected (${expected.toDecimalString()} ${code})`;
}

function compareInstant(stored: string, fixture: Fixture, profile: LocaleProfileData): Comparison {
  const accepted = [fixture.expected as string, ...(fixture.alternatives ?? [])];
  const zone = profile.timeZones[0] as string;
  const parsedDirect = Date.parse(stored);
  if (Number.isFinite(parsedDirect)) {
    const iso = new Date(parsedDirect).toISOString();
    if (accepted.some((value) => Math.abs(Date.parse(value) - Date.parse(iso)) < 1000)) return { equal: true };
    return {
      equal: false,
      rendered: iso,
      explanation: `stored instant ${iso} is not one of the accepted readings ${accepted.join(", ")} for ${profile.id}`,
    };
  }
  const parsed = parseWithAnyPattern(stored, profile.dateFormats.input);
  if (!parsed) {
    return {
      equal: false,
      rendered: stored,
      explanation: `stored value "${preview(stored)}" is not readable with the formats ${profile.id} declares (${profile.dateFormats.input.join(", ")})`,
    };
  }
  const resolution = resolveWallClock(zone, parsed.wall);
  const instants = resolution.kind === "unique" ? [resolution.instant] : resolution.kind === "ambiguous" ? resolution.instants : [resolution.nearestAfter];
  const match = instants.some((ms) => accepted.some((value) => Math.abs(ms - Date.parse(value)) < 60_000));
  return {
    equal: match,
    rendered: new Date(instants[0] as number).toISOString(),
    explanation: match
      ? undefined
      : `stored reading resolves to ${instants.map((ms) => new Date(ms).toISOString()).join(" or ")}, expected ${accepted.join(" or ")}`,
  };
}

function severityFor(fixture: Fixture): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO" {
  if (fixture.category === "currency") return fixture.expectation === "reject" ? "HIGH" : "CRITICAL";
  if (fixture.category === "identity") return fixture.expectation === "accept" ? "HIGH" : "MEDIUM";
  if (fixture.category === "phone") return "HIGH";
  if (fixture.category === "datetime") return "HIGH";
  if (fixture.category === "address") return "MEDIUM";
  return "LOW";
}

function describe(fixture: Fixture, profile: LocaleProfileData): string {
  const verb = fixture.expectation === "accept" ? "accepts and stores intact" : "refuses";
  return `${profile.region} (${profile.id}, ${profile.direction}, ${currencyMeta(profile.currency).name}): the product ${verb} ${fixture.field} = ${preview(fixture.value)}.${fixture.note ? ` ${fixture.note}` : ""}`;
}

/**
 * Render a fixture for a report line. Control characters become escapes instead of
 * invisible text: a report that shows "name = " for a NUL payload tells nobody
 * anything, and a reviewer cannot fix what they cannot see.
 */
export function preview(value: string, max = 48): string {
  const visible = value
    .replace(/[\u0000-\u001f\u007f]/g, (ch) => `\\u${ch.codePointAt(0)!.toString(16).padStart(4, "0")}`)
    .replace(/\u202e|\u200e|\u200f/g, (ch) => `< bidi U+${ch.codePointAt(0)!.toString(16).toUpperCase()} >`);
  return visible.length > max ? `${visible.slice(0, max)}… (${graphemeLength(value)} graphemes)` : visible;
}
