import {
  ANALYSIS_PROFILES,
  type AnalysisProfile,
  type AnalysisTargetType,
  CAPABILITIES,
  type Capability,
} from "@proofcore/core";

/**
 * Suggest a registered analysis profile from a stated goal.
 *
 * The product has six named profiles, and a model that invents a seventh ("SEO +
 * performance + checkout") promises something the planner cannot run. This function
 * only ranks the profiles the registry already documents: the goal is compared with
 * each profile's own name and description, then with the documented goals and
 * descriptions of the capabilities that profile contains. The matched terms are
 * returned so the answer can be checked, not trusted.
 *
 * It never picks a profile when nothing matches. A null recommendation is the honest
 * answer to "analyse my thing"; the caller is told to ask what the person wants to
 * check instead of guessing.
 */

/** Grammar words and request phrasing: never evidence of an intent. */
const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "does",
  "did",
  "can",
  "could",
  "should",
  "would",
  "are",
  "was",
  "were",
  "what",
  "when",
  "where",
  "how",
  "why",
  "from",
  "into",
  "about",
  "need",
  "want",
  "please",
  "check",
  "checks",
  "verify",
  "analyse",
  "analyze",
  "audit",
  "test",
  "est",
  "sont",
  "que",
  "qui",
  "les",
  "des",
  "une",
  "pour",
  "sur",
  "dans",
  "avec",
  "sans",
  "mon",
  "ma",
  "mes",
  "son",
  "sa",
  "ses",
  "leur",
  "leurs",
  "nous",
  "vous",
  "ils",
  "elles",
  "etre",
  "avoir",
  "fait",
  "faire",
  "peut",
  "peuvent",
  "veux",
  "veut",
  "souhaite",
  "besoin",
  "savoir",
  "comment",
  "quoi",
  "quel",
  "quelle",
  "quels",
  "quelles",
  "tout",
  "tous",
  "toute",
  "toutes",
  "plus",
  "moins",
  "bien",
  "par",
  "pas",
  "aux",
  "elle",
  "on",
  "lui",
  "dont",
  "donc",
  "car",
  "mais",
  "puis",
  "enfin",
  "alors",
  "ainsi",
  "aussi",
  "tres",
  "trop",
  "peu",
  "apres",
  "avant",
  "pendant",
  "depuis",
  "chaque",
  "autre",
  "autres",
  "meme",
  "memes",
  "cela",
  "ceci",
  "celui",
  "celle",
  "ceux",
  "celles",
  "is",
  "it",
  "its",
  "my",
  "our",
  "your",
  "their",
  "there",
  "which",
  "who",
  "whom",
  "be",
  "been",
  "has",
  "have",
  "had",
  "will",
  "shall",
  "may",
  "might",
  "must",
  "not",
  "all",
  "any",
  "some",
  "more",
  "most",
  "very",
  "also",
  "just",
  "only",
  "than",
  "then",
  "them",
  "they",
  "these",
  "those",
  "such",
  "other",
  "over",
  "under",
  "again",
  "once",
  "here",
  // Generic nouns and quality adjectives: present in almost every profile, so they
  // cannot distinguish an intent. "page" and "site" are the target, not the goal.
  "page",
  "pages",
  "site",
  "sites",
  "web",
  "website",
  "correct",
  "correcte",
  "correctes",
  "verifie",
  "verifier",
  "analyse",
  "analyser",
  "auditer",
  "tester",
]);

interface WeightedTokens {
  profile: AnalysisProfile;
  /** The profile's own name and description: a direct statement of intent. */
  headline: Set<string>;
  /** The goals and descriptions of the capabilities it runs. */
  detail: Set<string>;
}

const CAPABILITY_BY_ID = new Map<string, Capability>(CAPABILITIES.map((item) => [item.id, item]));

/**
 * A short root key, so "payer" and "paiement" meet without a stemming library.
 *
 * Two common suffixes are stripped (longest first, never below three letters), then
 * French y becomes i (payer/paiement) and the first five letters are kept. This joins
 * payer/paiement, indexé/indexation and accessibilité/accessible while leaving
 * formulaire and format apart. The key is only used for matching; the answer quotes
 * the person's own words.
 */
const SUFFIXES = [
  "issements",
  "issement",
  "abilities",
  "ability",
  "abilites",
  "abilite",
  "ibilites",
  "ibilite",
  "bilites",
  "bilite",
  "ations",
  "ation",
  "ements",
  "ement",
  "ities",
  "ity",
  "ites",
  "ite",
  "ibles",
  "ible",
  "ances",
  "ance",
  "ences",
  "ence",
  "ments",
  "ment",
  "ings",
  "ing",
  "ions",
  "ion",
  "ies",
  "es",
  "s",
  "er",
  "ee",
  "e",
];

function keyOf(token: string): string {
  let word = token;
  for (let pass = 0; pass < 2; pass += 1) {
    const suffix = SUFFIXES.find((item) => word.endsWith(item) && word.length - item.length >= 3);
    if (!suffix) break;
    word = word.slice(0, -suffix.length);
  }
  return word.replace(/y/g, "i").slice(0, 5);
}

/** Goal word → root key, keeping the original word for the answer. */
function tokensOf(text: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const raw of text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue;
    const key = keyOf(raw);
    if (!tokens.has(key)) tokens.set(key, raw);
  }
  return tokens;
}

function keySet(text: string): Set<string> {
  return new Set(tokensOf(text).keys());
}

const CORPORA: WeightedTokens[] = ANALYSIS_PROFILES.map((profile) => {
  const headline = keySet(
    [profile.fr.name, profile.fr.description, profile.en.name, profile.en.description].join(" ")
  );
  const detail = new Set<string>();
  for (const id of profile.capabilities) {
    const capability = CAPABILITY_BY_ID.get(id);
    if (!capability) continue;
    for (const token of keySet(
      [
        capability.goal,
        capability.fr.title,
        capability.fr.description,
        capability.en.title,
        capability.en.description,
      ].join(" ")
    )) {
      detail.add(token);
    }
  }
  return { profile, headline, detail };
});

export interface ProfileMatch {
  id: string;
  name: string;
  nameFr: string;
  description: string;
  targetType: AnalysisTargetType;
  modules: readonly string[];
  capabilities: readonly string[];
  matchedTerms: string[];
  /** 4 per token from the profile's own wording, 1 per capability wording token. */
  score: number;
}

export interface AnalysisProfileSuggestion {
  goal: string;
  targetType: AnalysisTargetType | null;
  recommendation: ProfileMatch | null;
  alternatives: ProfileMatch[];
  available: {
    id: string;
    name: string;
    targetType: AnalysisTargetType;
    modules: readonly string[];
  }[];
  saved: false;
  note: string;
  hint?: string;
}

function matchOf(entry: WeightedTokens, goalTokens: Map<string, string>): ProfileMatch {
  let score = 0;
  const matchedTerms: string[] = [];
  for (const [key, word] of goalTokens) {
    if (entry.headline.has(key)) {
      score += 4;
      matchedTerms.push(word);
    } else if (entry.detail.has(key)) {
      score += 1;
      matchedTerms.push(word);
    }
  }
  return {
    id: entry.profile.id,
    name: entry.profile.en.name,
    nameFr: entry.profile.fr.name,
    description: entry.profile.en.description,
    targetType: entry.profile.targetType,
    // Copies: the tool result is serialised by stableStringify, which refuses a value
    // referenced twice (the registry arrays appear in `available` as well).
    modules: [...entry.profile.modules],
    capabilities: [...entry.profile.capabilities],
    matchedTerms,
    score,
  };
}

export function suggestAnalysisProfile(
  goal: string,
  targetType?: AnalysisTargetType
): AnalysisProfileSuggestion {
  const goalTokens = tokensOf(goal);
  const candidates = CORPORA.filter(
    (entry) => !targetType || entry.profile.targetType === targetType
  );
  const ranked = candidates
    .map((entry) => matchOf(entry, goalTokens))
    .sort((left, right) => right.score - left.score);

  const available = ANALYSIS_PROFILES.map((profile) => ({
    id: profile.id,
    name: profile.en.name,
    targetType: profile.targetType,
    modules: [...profile.modules],
  }));
  const base = {
    goal,
    targetType: targetType ?? null,
    available,
    saved: false as const,
    note: "Derived only from the documented profile wording, not from a measurement. It does not launch anything and does not check that the project's modules are enabled: call module_status before promising a run.",
  };

  const [best, ...rest] = ranked;
  if (!best || best.score === 0) {
    return {
      ...base,
      recommendation: null,
      alternatives: [],
      hint: targetType
        ? `No registered profile wording matches this goal for a ${targetType} target. Ask what the person wants to check, or call capabilities; do not invent a profile.`
        : "No registered profile wording matches this goal. Ask what the person wants to check, or call capabilities; do not invent a profile.",
    };
  }

  return {
    ...base,
    recommendation: best,
    alternatives: rest.filter((match) => match.score > 0).slice(0, 2),
  };
}
