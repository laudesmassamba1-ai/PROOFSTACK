import {
  ArrowRight,
  BadgeCheck,
  Brain,
  Check,
  FolderKanban,
  Globe2,
  Info,
  PackageOpen,
  Route as RouteIcon,
  ScanLine,
  ShieldAlert,
  Terminal,
  X,
} from "lucide-react";
import { Link } from "react-router";
import { useI18n } from "../../i18n/index.js";
import { PageHeader } from "../../layouts/AppLayout.js";

/**
 * The in-app guide.
 *
 * The product has five named checks, two execution paths and a CLI. That vocabulary is
 * precise but not self-explanatory. This screen says what each control answers, what the
 * result means, and what the app deliberately does not do — with no demo data and no
 * promise the engine cannot keep.
 */

type Copy = { fr: string; en: string };

const START_PATHS: {
  icon: typeof ScanLine;
  title: Copy;
  body: Copy;
  cta: Copy;
  to: string;
}[] = [
  {
    icon: ScanLine,
    title: { fr: "J'ai une adresse de site", en: "I have a website address" },
    body: {
      fr: "Collez l'URL. Le scan lit la page publique et rend un premier verdict sans projet, sans installation et sans compte à configurer.",
      en: "Paste the URL. The scan reads the public page and returns a first verdict with no project, install or account setup.",
    },
    cta: { fr: "Analyser une adresse", en: "Scan an address" },
    to: "/app/start",
  },
  {
    icon: FolderKanban,
    title: { fr: "Je veux suivre une application", en: "I want to track an application" },
    body: {
      fr: "Créez un projet : son adresse, son environnement et les contrôles autorisés. L'historique et les corrections restent attachés à ce projet.",
      en: "Create a project: its address, environment and allowed checks. History and fixes stay attached to that project.",
    },
    cta: { fr: "Voir les projets", en: "See projects" },
    to: "/app/projects",
  },
  {
    icon: Terminal,
    title: { fr: "Je veux automatiser en CI", en: "I want to automate in CI" },
    body: {
      fr: "La CLI exécute les mêmes contrôles sur votre machine ou dans votre CI, puis téléverse le rapport seulement quand vous le demandez.",
      en: "The CLI runs the same checks on your machine or in CI, then uploads the report only when you ask it to.",
    },
    cta: { fr: "Configurer la CLI", en: "Set up the CLI" },
    to: "/app/cli",
  },
];

const CHECKS: {
  id: string;
  name: string;
  icon: typeof ShieldAlert;
  question: Copy;
  what: Copy;
  limit: Copy;
  links: { label: Copy; to: string }[];
}[] = [
  {
    id: "fail",
    name: "FAIL",
    icon: ShieldAlert,
    question: {
      fr: "Le site expose-t-il des failles visibles ?",
      en: "Does the site expose visible weaknesses?",
    },
    what: {
      fr: "En-têtes de sécurité, cookies, contenu mixte, bannières de version et erreurs trop bavardes. Chaque constat montre la valeur réellement observée.",
      en: "Security headers, cookies, mixed content, version banners and verbose errors. Every finding shows the value actually observed.",
    },
    limit: {
      fr: "Ce n'est pas un test d'intrusion : rien n'est attaqué, forgé ou modifié.",
      en: "This is not a penetration test: nothing is attacked, forged or modified.",
    },
    links: [
      { label: { fr: "Scanner", en: "Scan" }, to: "/app/scan" },
      { label: { fr: "Ouvrir FAIL", en: "Open FAIL" }, to: "/app/modules/fail" },
    ],
  },
  {
    id: "clean",
    name: "CLEAN",
    icon: BadgeCheck,
    question: {
      fr: "L'interface est-elle structurée et lisible ?",
      en: "Is the interface structured and readable?",
    },
    what: {
      fr: "Titre, description, langue, viewport, titres, textes alternatifs, libellés, repères, poids et temps de réponse.",
      en: "Title, description, language, viewport, headings, alternative text, labels, landmarks, weight and response time.",
    },
    limit: {
      fr: "Le scan ne dessine pas la page dans un navigateur. Sur une application React, Vue ou Next, les contrôles du DOM sont ignorés et CLEAN est « non mesuré », jamais vert par défaut.",
      en: "The scan does not draw the page in a browser. On a React, Vue or Next app, DOM checks are skipped and CLEAN is “not measured”, never green by default.",
    },
    links: [
      { label: { fr: "Scanner", en: "Scan" }, to: "/app/scan" },
      { label: { fr: "Ouvrir CLEAN", en: "Open CLEAN" }, to: "/app/modules/clean" },
    ],
  },
  {
    id: "flow",
    name: "FLOW",
    icon: RouteIcon,
    question: {
      fr: "Un utilisateur peut-il aller au bout ?",
      en: "Can a user complete the journey?",
    },
    what: {
      fr: "Point d'entrée du panier ou du paiement, étapes critiques, webhooks, doublons et remboursements. Un échec nomme l'étape qui casse.",
      en: "Cart or checkout entry point, critical steps, webhooks, duplicates and refunds. A failure names the step that breaks.",
    },
    limit: {
      fr: "Un scan d'adresse ne remplit pas un vrai panier. Le parcours complet demande une cible configurée et s'exécute avec la CLI, sur un environnement de test.",
      en: "An address scan does not fill a real cart. The full journey needs a configured target and runs with the CLI, against a test environment.",
    },
    links: [
      { label: { fr: "Voir FLOW", en: "See FLOW" }, to: "/app/modules/flow" },
      { label: { fr: "Configurer", en: "Configure" }, to: "/app/projects" },
    ],
  },
  {
    id: "world",
    name: "WORLD",
    icon: Globe2,
    question: {
      fr: "Les données internationales passent-elles ?",
      en: "Does international data survive?",
    },
    what: {
      fr: "Identité, téléphone, e-mail, adresse, devise, dates, formulaires, tri et collation sur plusieurs profils de pays.",
      en: "Identity, phone, email, address, currency, dates, forms, sorting and collation across country profiles.",
    },
    limit: {
      fr: "Sans cible ni jeux de données, les cas sont ignorés. Ignoré ne veut pas dire réussi.",
      en: "Without a target and fixtures, cases are skipped. Skipped does not mean passed.",
    },
    links: [{ label: { fr: "Voir WORLD", en: "See WORLD" }, to: "/app/modules/world" }],
  },
  {
    id: "exit",
    name: "EXIT",
    icon: PackageOpen,
    question: {
      fr: "Les données ressortent-elles intactes ?",
      en: "Does the data come back intact?",
    },
    what: {
      fr: "Formats d'export, validité du schéma, relations entre les objets et fidélité d'un aller-retour export puis réimport.",
      en: "Export formats, schema validity, relationships between objects and export-then-reimport fidelity.",
    },
    limit: {
      fr: "Rien n'est lancé sur vos données de production par défaut. Il faut une source d'export et un jeu de test.",
      en: "Nothing runs against production data by default. It needs an export source and a test dataset.",
    },
    links: [{ label: { fr: "Voir EXIT", en: "See EXIT" }, to: "/app/modules/exit" }],
  },
];

const STATUSES: { tone: string; label: Copy; body: Copy }[] = [
  {
    tone: "app-badge-success",
    label: { fr: "Réussi", en: "Passed" },
    body: {
      fr: "Le contrôle a été exécuté et la valeur observée respecte la règle.",
      en: "The check ran and the observed value follows the rule.",
    },
  },
  {
    tone: "app-badge-danger",
    label: { fr: "Échec", en: "Failed" },
    body: {
      fr: "Le contrôle a été exécuté et la règle n'est pas respectée. C'est un défaut démontrable.",
      en: "The check ran and the rule is not met. This is a demonstrable defect.",
    },
  },
  {
    tone: "app-badge-warning",
    label: { fr: "Avertissement", en: "Warning" },
    body: {
      fr: "Le contrôle a été exécuté, mais le problème n'est pas bloquant. Il mérite une décision.",
      en: "The check ran, but the issue is not blocking. It deserves a decision.",
    },
  },
  {
    tone: "",
    label: { fr: "Ignoré", en: "Skipped" },
    body: {
      fr: "Le contrôle n'a pas pu ou n'a pas eu à s'exécuter. Ce n'est ni une réussite ni un échec.",
      en: "The check could not run, or did not apply. It is neither a pass nor a failure.",
    },
  },
  {
    tone: "app-badge-accent",
    label: { fr: "Non mesuré", en: "Not measured" },
    body: {
      fr: "Aucun contrôle de cette famille n'a été jugé. Le score est masqué au lieu d'afficher un faux 100 ou un faux 0.",
      en: "No check in this family was judged. The score is hidden instead of showing a false 100 or 0.",
    },
  },
];

const STEPS: { title: Copy; body: Copy }[] = [
  {
    title: { fr: "Observez d'abord", en: "Observe first" },
    body: {
      fr: "Un scan d'adresse donne les problèmes les plus visibles en quelques secondes. Lisez les échecs avant de configurer quoi que ce soit.",
      en: "An address scan surfaces the most visible issues in seconds. Read the failures before configuring anything.",
    },
  },
  {
    title: { fr: "Comprenez l'impact", en: "Understand the impact" },
    body: {
      fr: "Chaque constat vient avec la valeur observée, la règle et la raison. L'IA peut ensuite expliquer les trois corrections les plus rentables.",
      en: "Every finding comes with the observed value, the rule and the reason. AI can then explain the three most valuable fixes.",
    },
  },
  {
    title: { fr: "Corrigez, puis revérifiez", en: "Fix, then verify" },
    body: {
      fr: "Une correction n'est prouvée que par un nouveau contrôle qui passe. L'historique garde l'avant et l'après.",
      en: "A fix is proven only by a new check that passes. History keeps the before and after.",
    },
  },
  {
    title: { fr: "Automatisez ce qui compte", en: "Automate what matters" },
    body: {
      fr: "Quand le parcours est stable, branchez la CLI dans la CI pour rejouer les mêmes contrôles à chaque changement.",
      en: "Once the path is stable, wire the CLI into CI to replay the same checks on every change.",
    },
  },
];

const GLOSSARY: { term: Copy; body: Copy }[] = [
  {
    term: { fr: "Espace de travail", en: "Workspace" },
    body: {
      fr: "Le conteneur de vos projets et de vos résultats. Il isole vos données des autres comptes.",
      en: "The container for your projects and results. It keeps your data separate from other accounts.",
    },
  },
  {
    term: { fr: "Projet", en: "Project" },
    body: {
      fr: "Une application ou un site suivi : une adresse de base, un environnement, des modules autorisés.",
      en: "A tracked application or site: a base address, an environment, allowed modules.",
    },
  },
  {
    term: { fr: "Exécution", en: "Run" },
    body: {
      fr: "Une passe de contrôles à un instant donné, avec sa durée, ses résultats et ses constats.",
      en: "One pass of checks at a given time, with its duration, results and findings.",
    },
  },
  {
    term: { fr: "Constat", en: "Finding" },
    body: {
      fr: "Un contrôle précis, la valeur observée, la règle et la conséquence. C'est la preuve, pas une impression.",
      en: "One precise check, the observed value, the rule and the consequence. It is evidence, not an impression.",
    },
  },
  {
    term: { fr: "Module", en: "Module" },
    body: {
      fr: "Une famille de contrôles qui répond à une seule question : FAIL, CLEAN, FLOW, WORLD ou EXIT.",
      en: "A family of checks answering one question: FAIL, CLEAN, FLOW, WORLD or EXIT.",
    },
  },
  {
    term: { fr: "Jeton de projet", en: "Project token" },
    body: {
      fr: "Un identifiant limité à un projet, affiché une fois, utilisé par la CLI ou la CI. Ce n'est pas votre mot de passe.",
      en: "A credential limited to one project, shown once, used by the CLI or CI. It is not your password.",
    },
  },
];

const LIMITS: Copy[] = [
  {
    fr: "Le scan d'adresse ne clique pas, ne se connecte pas et ne lance pas JavaScript comme un navigateur.",
    en: "The address scan does not click, sign in, or run JavaScript like a browser.",
  },
  {
    fr: "Un contrôle ignoré ou non mesuré n'est jamais compté comme une réussite.",
    en: "A skipped or unmeasured check is never counted as a pass.",
  },
  {
    fr: "PROOFCORE ne corrige pas votre code tout seul et ne garantit pas qu'un site est sans défaut.",
    en: "PROOFCORE does not fix your code by itself and does not guarantee a site is defect-free.",
  },
  {
    fr: "Les parcours complets et les données internationales demandent une cible de test configurée.",
    en: "Full journeys and international data require a configured test target.",
  },
  {
    fr: "Rien n'est facturé ni activé sans un paiement vérifié par le fournisseur.",
    en: "Nothing is billed or activated without a provider-verified payment.",
  },
];

export function GuidePage() {
  const { locale } = useI18n();
  const fr = locale === "fr";
  const pick = (copy: Copy) => (fr ? copy.fr : copy.en);

  return (
    <div className="app-page">
      <PageHeader
        eyebrow={fr ? "GUIDE / COMMENCER" : "GUIDE / START HERE"}
        title={fr ? "GUIDE PROOFCORE." : "PROOFCORE GUIDE."}
        description={
          fr
            ? "Cinq contrôles, un verdict honnête et trois façons de commencer. Cette page explique ce que l'app fait, ce qu'elle ne fait pas, et quoi lire en premier."
            : "Five checks, an honest verdict and three ways to start. This page explains what the app does, what it does not do, and what to read first."
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/app/start" className="app-btn app-btn-primary app-btn-sm">
              <ScanLine size={14} /> {fr ? "Analyser une adresse" : "Scan an address"}
            </Link>
            <Link to="/app/projects" className="app-btn app-btn-sm">
              <FolderKanban size={14} /> {fr ? "Mes projets" : "My projects"}
            </Link>
          </div>
        }
      />

      <section className="app-sheet mb-4 px-5 py-4" aria-labelledby="guide-oneline-title">
        <div className="flex items-start gap-3">
          <Info size={18} className="mt-0.5 shrink-0 text-primary" aria-hidden />
          <div>
            <h2 id="guide-oneline-title" className="text-sm font-semibold">
              {fr ? "En une phrase" : "In one sentence"}
            </h2>
            <p className="mt-1 max-w-[78ch] text-sm leading-relaxed text-muted">
              {fr
                ? "PROOFCORE rejoue des contrôles reproductibles sur un site, une application ou des fichiers, puis montre la valeur observée, la règle et la conséquence — sans transformer une mesure absente en réussite."
                : "PROOFCORE replays reproducible checks on a site, an application or files, then shows the observed value, the rule and the consequence — without turning a missing measurement into a pass."}
            </p>
          </div>
        </div>
      </section>

      <section className="app-section" aria-labelledby="guide-start-title">
        <div className="app-section-head">
          <div>
            <p className="app-eyebrow">01 / {fr ? "POINT DE DÉPART" : "STARTING POINT"}</p>
            <h2 id="guide-start-title" className="app-section-title">
              {fr ? "Choisissez ce que vous avez sous la main." : "Choose what you have at hand."}
            </h2>
            <p className="app-support">
              {fr
                ? "Aucun parcours n'est obligatoire. Les trois mènent aux mêmes contrôles, avec plus ou moins de suivi."
                : "No path is mandatory. All three lead to the same checks, with more or less tracking."}
            </p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {START_PATHS.map((path, index) => {
            const Icon = path.icon;
            return (
              <Link
                key={path.to}
                to={path.to}
                className="rounded-[var(--radius)] border border-black/10 bg-surface-alt px-5 py-4 transition-colors hover:border-black/30"
              >
                <span className="app-eyebrow">0{index + 1}</span>
                <span className="mt-2 flex items-center gap-2 text-base font-semibold">
                  <Icon size={16} className="text-primary" aria-hidden />
                  {pick(path.title)}
                </span>
                <span className="mt-1 block text-sm leading-relaxed text-muted">
                  {pick(path.body)}
                </span>
                <span className="app-text-link mt-3 inline-flex">
                  {pick(path.cta)} <ArrowRight size={13} />
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="app-section" aria-labelledby="guide-checks-title">
        <div className="app-section-head">
          <div>
            <p className="app-eyebrow">02 / {fr ? "LES CINQ CONTRÔLES" : "THE FIVE CHECKS"}</p>
            <h2 id="guide-checks-title" className="app-section-title">
              {fr
                ? "Chaque module répond à une question simple."
                : "Each module answers one simple question."}
            </h2>
            <p className="app-support">
              {fr
                ? "Le nom du module est technique. La question, elle, ne l'est pas."
                : "The module name is technical. The question is not."}
            </p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {CHECKS.map((check) => {
            const Icon = check.icon;
            return (
              <article key={check.id} className={`app-workbench module-${check.id} p-4`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <Icon size={16} className="text-primary" aria-hidden />
                    <span className="app-object-name !text-lg">{check.name}</span>
                  </span>
                  <span className="app-object-index">0{CHECKS.indexOf(check) + 1}</span>
                </div>
                <h3 className="mt-2 text-sm font-semibold">{pick(check.question)}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted">{pick(check.what)}</p>
                <p className="mt-2 border-t border-black/10 pt-2 text-xs leading-relaxed text-muted">
                  <strong className="font-medium text-ink">
                    {fr ? "Ce qu'il ne fait pas : " : "What it does not do: "}
                  </strong>
                  {pick(check.limit)}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {check.links.map((link) => (
                    <Link key={link.to} to={link.to} className="app-text-link text-xs">
                      {pick(link.label)} <ArrowRight size={12} />
                    </Link>
                  ))}
                </div>
              </article>
            );
          })}
          <article className="app-workbench p-4">
            <div className="flex items-center gap-2">
              <Brain size={16} className="text-primary" aria-hidden />
              <span className="app-object-name !text-lg">IA</span>
            </div>
            <h3 className="mt-2 text-sm font-semibold">
              {fr
                ? "L'IA explique et propose, elle ne mesure pas."
                : "AI explains and suggests; it does not measure."}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              {fr
                ? "Elle lit les constats et les fichiers importés pour dire quoi corriger d'abord. Le verdict reste celui des contrôles ; une réponse de modèle n'est jamais une preuve."
                : "It reads findings and imported files to say what to fix first. The verdict stays with the checks; a model answer is never evidence."}
            </p>
            <Link to="/app/ai" className="app-text-link mt-3 inline-flex text-xs">
              {fr ? "Ouvrir l'assistant" : "Open the assistant"} <ArrowRight size={12} />
            </Link>
          </article>
        </div>
      </section>

      <section className="app-section" aria-labelledby="guide-status-title">
        <div className="app-section-head">
          <div>
            <p className="app-eyebrow">03 / {fr ? "LIRE UN RÉSULTAT" : "READ A RESULT"}</p>
            <h2 id="guide-status-title" className="app-section-title">
              {fr
                ? "Un statut n'est pas un score décoratif."
                : "A status is not a decorative score."}
            </h2>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {STATUSES.map((status) => (
            <div
              key={status.label.fr}
              className="rounded-[var(--radius)] border border-black/10 px-4 py-3"
            >
              <span className={`app-badge ${status.tone}`}>{pick(status.label)}</span>
              <p className="mt-2 text-xs leading-relaxed text-muted">{pick(status.body)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="app-section" aria-labelledby="guide-path-title">
        <div className="app-section-head">
          <div>
            <p className="app-eyebrow">04 / {fr ? "LE BON ORDRE" : "THE RIGHT ORDER"}</p>
            <h2 id="guide-path-title" className="app-section-title">
              {fr
                ? "Du premier scan à la vérification continue."
                : "From first scan to continuous verification."}
            </h2>
          </div>
        </div>
        <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {STEPS.map((step, index) => (
            <li
              key={step.title.fr}
              className="rounded-[var(--radius)] border border-black/10 px-4 py-4"
            >
              <span className="app-object-index">0{index + 1}</span>
              <h3 className="mt-2 text-sm font-semibold">{pick(step.title)}</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted">{pick(step.body)}</p>
            </li>
          ))}
        </ol>
      </section>

      <div className="app-overview-body">
        <section className="app-workbench" aria-labelledby="guide-vocab-title">
          <header className="app-workbench-head">
            <div>
              <p className="app-eyebrow">05 / {fr ? "VOCABULAIRE" : "VOCABULARY"}</p>
              <h2 id="guide-vocab-title" className="app-workbench-title">
                {fr ? "Les mots que l'app emploie." : "The words the app uses."}
              </h2>
            </div>
          </header>
          <dl className="grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2">
            {GLOSSARY.map((entry) => (
              <div key={entry.term.fr}>
                <dt className="text-sm font-medium">{pick(entry.term)}</dt>
                <dd className="mt-0.5 text-xs leading-relaxed text-muted">{pick(entry.body)}</dd>
              </div>
            ))}
          </dl>
        </section>

        <aside className="app-workbench" aria-labelledby="guide-limits-title">
          <header className="app-workbench-head">
            <div>
              <p className="app-eyebrow">06 / {fr ? "HONNÊTETÉ" : "HONESTY"}</p>
              <h2 id="guide-limits-title" className="app-workbench-title">
                {fr ? "Ce que PROOFCORE ne fait pas." : "What PROOFCORE does not do."}
              </h2>
            </div>
          </header>
          <ul className="space-y-3 p-5">
            {LIMITS.map((limit) => (
              <li key={limit.fr} className="flex gap-2 text-xs leading-relaxed text-muted">
                <X size={13} className="mt-0.5 shrink-0 text-danger" aria-hidden />
                <span>{pick(limit)}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      <section className="app-section" aria-labelledby="guide-nav-title">
        <div className="app-section-head">
          <div>
            <p className="app-eyebrow">07 / {fr ? "NAVIGATION" : "NAVIGATION"}</p>
            <h2 id="guide-nav-title" className="app-section-title">
              {fr ? "Où trouver quoi." : "Where to find what."}
            </h2>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-[var(--radius)] border border-black/10 px-4 py-4">
            <p className="text-sm font-semibold">{fr ? "Mode simple" : "Simple mode"}</p>
            <ul className="mt-2 space-y-1.5 text-xs text-muted">
              <li>
                <strong className="text-ink">{fr ? "Vue d'ensemble" : "Overview"}</strong> —{" "}
                {fr ? "la situation et la prochaine action." : "the situation and the next action."}
              </li>
              <li>
                <strong className="text-ink">{fr ? "Projets" : "Projects"}</strong> —{" "}
                {fr
                  ? "les applications suivies et leur historique."
                  : "tracked applications and their history."}
              </li>
              <li>
                <strong className="text-ink">{fr ? "Analyser" : "Scan"}</strong> —{" "}
                {fr ? "une adresse, un résultat immédiat." : "one address, an immediate result."}
              </li>
              <li>
                <strong className="text-ink">Guide</strong> — {fr ? "cette page." : "this page."}
              </li>
            </ul>
          </div>
          <div className="rounded-[var(--radius)] border border-black/10 px-4 py-4">
            <p className="text-sm font-semibold">{fr ? "Mode expert" : "Expert mode"}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              {fr
                ? "Ajoute l'espace de travail, les modules, la CLI, l'IA, la facturation et les paramètres. Le bouton « Mode expert » dans l'en-tête bascule entre les deux ; aucune donnée ne bouge."
                : "Adds the workspace, modules, CLI, AI, billing and settings. The “Expert mode” button in the header switches between them; no data moves."}
            </p>
          </div>
        </div>
      </section>

      <section className="app-next-action" aria-labelledby="guide-next-title">
        <div>
          <p className="app-eyebrow">{fr ? "PROCHAINE ACTION" : "NEXT ACTION"}</p>
          <h2 id="guide-next-title" className="app-next-title">
            {fr ? "UNE ADRESSE SUFFIT POUR COMMENCER." : "ONE ADDRESS IS ENOUGH TO START."}
          </h2>
          <p className="app-next-body">
            {fr
              ? "Le premier scan ne demande ni projet ni installation. Il vous donne des faits ; vous décidez ensuite quoi suivre et quoi automatiser."
              : "The first scan needs no project or install. It gives you facts; you then decide what to track and what to automate."}
          </p>
        </div>
        <div className="app-next-actions">
          <Link to="/app/start" className="app-btn app-btn-mint">
            <ScanLine size={14} /> {fr ? "Analyser mon site" : "Scan my site"}{" "}
            <ArrowRight size={14} />
          </Link>
          <Link to="/app/projects" className="app-btn app-btn-paper">
            {fr ? "Créer un projet" : "Create a project"}
          </Link>
        </div>
      </section>

      <p className="flex items-center justify-center gap-2 pb-6 text-center text-[11px] text-muted">
        <Check size={12} className="text-success" aria-hidden />
        {fr
          ? "Chaque chiffre affiché vient d'une exécution ou d'un scan réel. Aucune donnée de démonstration n'est présentée comme la vôtre."
          : "Every number shown comes from a real run or scan. No demo data is presented as yours."}
      </p>
    </div>
  );
}
