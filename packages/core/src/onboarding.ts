import type { AnalysisProfile } from "./capabilities.js";
import { profileById } from "./capabilities.js";

/**
 * Onboarding, and the Simple/Studio split.
 *
 * The two experiences are not two products: they read the same analyses, the same
 * findings and the same remediations. What changes is how much the person is asked to
 * decide. Simple asks a goal and runs the profile that answers it; Studio lets someone
 * choose modules and read the raw evidence. The choice is stored with the workspace so a
 * teammate opening the same project sees the same starting point.
 */

export const EXPERIENCE_MODES = ["simple", "studio"] as const;
export type ExperienceMode = (typeof EXPERIENCE_MODES)[number];

export const PROJECT_TYPES = ["site", "shop", "saas", "api", "local"] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const ONBOARDING_GOALS = [
  "conversion",
  "indexing",
  "security",
  "discovery",
  "quality",
] as const;
export type OnboardingGoal = (typeof ONBOARDING_GOALS)[number];

export const EXPERIENCE_LEVELS = ["beginner", "intermediate", "expert"] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

export const PROJECT_TYPE_LABELS: Record<ProjectType, { fr: string; en: string; hint: { fr: string; en: string } }> = {
  site: {
    fr: "Site vitrine ou institutionnel",
    en: "Marketing or institutional site",
    hint: { fr: "Des pages publiques à lire, indexer et protéger.", en: "Public pages to read, index and protect." },
  },
  shop: {
    fr: "Boutique en ligne",
    en: "Online shop",
    hint: { fr: "Un parcours d'achat qui doit aboutir.", en: "A purchase journey that has to complete." },
  },
  saas: {
    fr: "Application SaaS",
    en: "SaaS application",
    hint: { fr: "Des écrans derrière une connexion, des parcours à valider.", en: "Screens behind a login, journeys to validate." },
  },
  api: {
    fr: "API",
    en: "API",
    hint: { fr: "Pas de page à scanner : des contrats et des réponses à contrôler.", en: "No page to scan: contracts and responses to check." },
  },
  local: {
    fr: "Projet local",
    en: "Local project",
    hint: { fr: "Du code et des fichiers sur ta machine, pas un site public.", en: "Code and files on your machine, not a public site." },
  },
};

export const EXPERIENCE_LEVEL_LABELS: Record<ExperienceLevel, { fr: string; en: string }> = {
  beginner: { fr: "Je débute", en: "I'm starting out" },
  intermediate: { fr: "Je connais les bases", en: "I know the basics" },
  expert: { fr: "Expert", en: "Expert" },
};

export const ONBOARDING_GOAL_LABELS: Record<
  OnboardingGoal,
  { fr: string; en: string; question: { fr: string; en: string } }
> = {
  conversion: {
    fr: "Faire aboutir une vente",
    en: "Complete a sale",
    question: {
      fr: "Un client peut-il aller jusqu'au paiement sans être bloqué ?",
      en: "Can a customer reach payment without getting stuck?",
    },
  },
  indexing: {
    fr: "Être trouvé",
    en: "Be found",
    question: {
      fr: "Les moteurs lisent-ils les bonnes pages, avec les bons titres ?",
      en: "Do search engines read the right pages with the right titles?",
    },
  },
  security: {
    fr: "Être protégé",
    en: "Be protected",
    question: {
      fr: "Les protections de base sont-elles en place sur tout le site ?",
      en: "Are the basic protections in place across the site?",
    },
  },
  discovery: {
    fr: "Faire le tour",
    en: "See the whole picture",
    question: {
      fr: "Que mesure-t-on, et qu'est-ce qui reste non mesuré ?",
      en: "What gets measured, and what stays unmeasured?",
    },
  },
  quality: {
    fr: "Vérifier la qualité",
    en: "Check quality",
    question: {
      fr: "La page est-elle lisible, accessible et propre ?",
      en: "Is the page readable, accessible and clean?",
    },
  },
};

/** Which profile answers each goal, when the project type can carry it. */
const GOAL_PROFILE: Record<OnboardingGoal, string> = {
  conversion: "conversion",
  indexing: "seo",
  security: "security",
  discovery: "full",
  quality: "quick",
};

export interface OnboardingState {
  experience: ExperienceMode;
  projectType: ProjectType | null;
  goal: OnboardingGoal | null;
  level: ExperienceLevel | null;
  target: string | null;
  completed: boolean;
  completedAt: string | null;
}

export const EMPTY_ONBOARDING: OnboardingState = {
  experience: "simple",
  projectType: null,
  goal: null,
  level: null,
  target: null,
  completed: false,
  completedAt: null,
};

export interface OnboardingProfileRecommendation {
  /** The profile to run, or null when this target type has none. */
  profile: AnalysisProfile | null;
  modules: string[];
  reason: { fr: string; en: string };
}

/**
 * Choose the profile from the goal, and refuse honestly when the target type cannot
 * carry a site analysis: an API project has no page to scan, so it gets no fake answer.
 */
export function recommendProfile(input: {
  projectType: ProjectType;
  goal: OnboardingGoal;
}): OnboardingProfileRecommendation {
  if (input.projectType === "api" || input.projectType === "local") {
    return {
      profile: null,
      modules: [],
      reason: {
        fr: "Un projet d'API ou d'environnement local n'a pas de page à analyser : choisis une analyse de projet.",
        en: "An API or local-environment project has no page to analyse: choose a project analysis.",
      },
    };
  }
  const profile = profileById(GOAL_PROFILE[input.goal]) ?? null;
  if (!profile) {
    return {
      profile: null,
      modules: [],
      reason: { fr: "Aucun profil ne répond à cet objectif.", en: "No profile answers this goal." },
    };
  }
  return {
    profile,
    modules: profile.modules,
    reason:
      input.projectType === "shop" && input.goal === "conversion"
        ? {
            fr: "Une boutique avec un objectif de vente commence par le parcours d'achat.",
            en: "A shop with a sales goal starts with the purchase journey.",
          }
        : {
            fr: `Le profil ${profile.id} répond à cet objectif.`,
            en: `The ${profile.id} profile answers this goal.`,
          },
  };
}

/** What the onboarding still needs before it can be called complete. */
export const ONBOARDING_REQUIRED_FIELDS = ["projectType", "goal", "level", "target"] as const;

export function onboardingProgress(state: OnboardingState): {
  filled: number;
  total: number;
  next: string | null;
  complete: boolean;
} {
  const filled = ONBOARDING_REQUIRED_FIELDS.filter((field) => {
    const value = state[field];
    return typeof value === "string" && value.length > 0;
  }).length;
  const next = ONBOARDING_REQUIRED_FIELDS.find((field) => {
    const value = state[field];
    return !(typeof value === "string" && value.length > 0);
  });
  return {
    filled,
    total: ONBOARDING_REQUIRED_FIELDS.length,
    next: next ?? null,
    complete: filled === ONBOARDING_REQUIRED_FIELDS.length,
  };
}

/**
 * The steps each experience shows.
 *
 * Simple has three: what to check, run it, read the result. Studio adds project
 * configuration, module choice and the evidence trail. Both end on the same findings.
 */
export const ONBOARDING_STEPS: Record<ExperienceMode, readonly string[]> = {
  simple: ["choose_goal", "run_profile", "read_findings"],
  studio: [
    "choose_goal",
    "configure_project",
    "choose_modules",
    "run_profile",
    "read_findings",
    "open_evidence",
  ],
};
