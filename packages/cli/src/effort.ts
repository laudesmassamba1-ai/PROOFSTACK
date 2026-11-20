/**
 * Effort levels: one dial the user understands, three consequences they care about.
 *
 * Low effort should cost fewer tokens — not fewer results. So the dial maps to three
 * concrete things: how many sub-agents the model is told to spawn (never fewer than two,
 * because one agent re-reading its own output is not review), how far a turn may run
 * (maxSteps), and how deep an audit must go before it stops. The model cannot read this
 * module; it reads the prompt block built from it, which is why the wording lives here.
 */

export type EffortLevel = "low" | "medium" | "high";

export interface EffortProfile {
  level: EffortLevel;
  /** Sub-agents the model is instructed to create. 0 means "work alone". */
  subagents: number;
  /** Hard ceiling on tool steps per turn, passed to the session loop. */
  maxSteps: number;
  /** How many audit families to chase before reporting. */
  auditDepth: "essential" | "standard" | "deep";
  /** Human phrase for the status line. */
  label: string;
}

export const EFFORT_LEVELS: readonly EffortLevel[] = ["low", "medium", "high"];

export function effortProfile(level: EffortLevel | undefined): EffortProfile {
  switch (level) {
    case "low":
      return {
        level: "low",
        subagents: 0,
        maxSteps: 10,
        auditDepth: "essential",
        label: "effort bas · rapide et économe",
      };
    case "high":
      return {
        level: "high",
        subagents: 3,
        maxSteps: 28,
        auditDepth: "deep",
        label: "effort élevé · vérifications croisées",
      };
    default:
      // Medium is the default because it is the level a new user's first question needs:
      // two agents minimum, as the product promises, without burning a whole budget.
      return {
        level: "medium",
        subagents: 2,
        maxSteps: 18,
        auditDepth: "standard",
        label: "effort moyen · 2 sous-agents",
      };
  }
}

/**
 * The prompt block that tells the model how to organise its own work.
 *
 * "Force" is honest here: this is an instruction the model is expected to follow, not a
 * runtime it can be forced into. It is worded as a rule with a concrete minimum so a model
 * that would rather do everything alone is pulled towards delegation.
 */
export function subagentPrompt(profile: EffortProfile): string {
  if (profile.subagents === 0) {
    return [
      "Travaille seul ce tour : l'utilisateur a choisi un effort bas, les sous-agents sont désactivés.",
      "Les vérifications essentielles suffisent ; n'ouvre pas les fichiers à nouveau pour confirmer ce qu'un test a déjà établi.",
    ].join("\n");
  }
  const depth = {
    essential:
      "Les vérifications essentielles suffisent ; n'ouvre pas les fichiers à nouveau pour confirmer ce qu'un test a déjà établi.",
    standard:
      "Vérifie chaque famille de règles ; recoupe les résultats entre eux avant de conclure.",
    deep: "Pousse chaque famille jusqu'au code, recoupe les résultats entre eux, et signale ce que tu n'as pas pu vérifier.",
  }[profile.auditDepth];

  return [
    `Niveau d'effort demandé : ${profile.level}.`,
    `Tu disposes de l'outil \`delegate\` : dès que deux parties du problème sont indépendantes, ouvre au minimum ${profile.subagents} sous-agents avec des questions étroites (relecture, vérification croisée, exploration parallèle) — davantage si le travail s'y prête. Un sous-agent lit et rapporte, il ne modifie rien : c'est toi qui écris.`,
    "Chaque sous-agent reçoit un objectif précis, un périmètre de fichiers, et rapporte des faits avec leurs emplacements — pas des impressions.",
    `Un sous-agent relecture doit rejeter ou confirmer les conclusions des autres ; une conclusion qu'un autre agent n'a pas pu repasser ne se dit pas « vérifiée ».`,
    depth,
  ].join("\n");
}

/** Parse a user-provided value; unknown words fall back to medium rather than crashing. */
export function parseEffort(value: string | undefined): EffortLevel {
  const normalized = (value ?? "").trim().toLowerCase();
  if ((EFFORT_LEVELS as readonly string[]).includes(normalized)) {
    return normalized as EffortLevel;
  }
  return "medium";
}
