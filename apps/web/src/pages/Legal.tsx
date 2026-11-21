import { Link } from "react-router";

/**
 * Legal pages.
 *
 * Everything that is a fact about the company is written as an explicit placeholder:
 * a fabricated legal entity, address or jurisdiction would be worse than a blank,
 * because it would be published as true. Each placeholder is listed at the top of the
 * page so it cannot ship unnoticed.
 *
 * What is NOT a placeholder is the description of what the software does: those
 * statements are verified against the code (encrypted key storage, local execution,
 * no third-party analytics, data retention).
 */

const PLACEHOLDERS = [
  "raison sociale exacte (LEGAL_ENTITY_NAME)",
  "forme juridique et numéro d'immatriculation (LEGAL_REGISTRATION)",
  "adresse du siège (LEGAL_ADDRESS)",
  "juridiction compétente (LEGAL_JURISDICTION)",
  "contact de traitement des données (LEGAL_DPO_CONTACT)",
];

function Shell({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-14 text-white/72">
      <p className="text-[11px] uppercase tracking-[0.18em] text-white/40">PROOFSTACK</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">{title}</h1>
      <p className="mt-1 text-xs text-white/40">Dernière mise à jour : {updated}</p>
      <div className="mt-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
        <strong>À compléter avant publication commerciale.</strong> Les éléments suivants dépendent
        de l'entité qui exploite le service et ne peuvent pas être inventés :
        <ul className="mt-1.5 list-disc pl-4">
          {PLACEHOLDERS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <div className="mt-8 space-y-5 text-sm leading-relaxed text-white/72">{children}</div>
      <p className="mt-10 text-xs text-white/40">
        <Link to="/signup" className="underline hover:text-white">
          Créer un compte
        </Link>{" "}
        ·{" "}
        <Link to="/support" className="underline hover:text-white">
          Assistance
        </Link>{" "}
        ·{" "}
        <Link to="/pricing" className="underline hover:text-white">
          Tarifs
        </Link>
      </p>
    </div>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-7 text-base font-semibold tracking-tight text-white">{children}</h2>;
}

export function Terms() {
  return (
    <Shell title="Conditions d'utilisation" updated="novembre 2026">
      <p>
        PROOFSTACK est un logiciel de vérification de qualité. Les tests s'exécutent sur votre
        machine ou dans votre CI ; les résultats que vous synchronisez sont stockés pour être
        consultés et partagés.
      </p>

      <H>1. Compte et sécurité</H>
      <p>
        Vous êtes responsable de la confidentialité de vos identifiants et des clés API que vous
        enregistrez. Les clés de fournisseurs d'IA sont chiffrées côté serveur (AES-256-GCM) et ne
        sont jamais renvoyées au navigateur. Signalez immédiatement tout accès non autorisé via{" "}
        <Link to="/support" className="text-white underline">
          l'assistance
        </Link>
        .
      </p>

      <H>2. Usage acceptable</H>
      <p>
        Vous ne devez lancer des audits que sur des systèmes que vous êtes autorisé à tester.
        L'outil n'exécute pas d'attaque destructive, mais un audit HTTP reste une requête émise
        depuis votre infrastructure : l'autorisation vous incombe.
      </p>

      <H>3. Abonnements et facturation</H>
      <p>
        Les prix affichés sont ceux du plan choisi au moment de l'achat. Un changement de plan prend
        effet à la période suivante ; la résiliation est possible à tout moment et le service reste
        actif jusqu'à la fin de la période payée. Les remboursements sont traités manuellement par
        l'opérateur, le prestataire de paiement n'exposant pas d'API de remboursement automatisée.
      </p>

      <H>4. Disponibilité et garanties</H>
      <p>
        Le logiciel est fourni « en l'état ». Les scores et rapports reflètent ce qui a été mesuré
        lors de l'exécution, à la date de l'exécution ; ils ne constituent pas une garantie
        d'absence de défaut.
      </p>

      <H>5. Résiliation et données</H>
      <p>
        Vous pouvez supprimer votre compte et vos données à tout moment depuis l'application ou en
        écrivant à l'assistance. La suppression est effective immédiatement pour les données actives
        ; les journaux techniques peuvent être conservés jusqu'à 30 jours.
      </p>

      <H>6. Droit applicable</H>
      <p>
        Les présentes conditions sont régies par le droit de <em>[LEGAL_JURISDICTION]</em>. Les
        tribunaux compétents sont ceux de <em>[LEGAL_ADDRESS]</em>.
      </p>
    </Shell>
  );
}

export function Privacy() {
  return (
    <Shell title="Politique de confidentialité" updated="novembre 2026">
      <p>
        Cette page décrit les données réellement traitées par le service. Elle est vérifiable dans
        le code : chaque catégorie listée correspond à une table ou un champ existant.
      </p>

      <H>Données de compte</H>
      <p>
        Adresse e-mail, nom, empreinte du mot de passe (PBKDF2, jamais le mot de passe en clair),
        date de création, date de vérification de l'adresse. Finalité : authentification et support.
        Base légale : exécution du contrat.
      </p>

      <H>Données d'exécution</H>
      <p>
        Résultats des tests que vous synchronisez : identifiants de run, modules, constats,
        empreintes d'évidence. Les preuves locales ne quittent votre machine que si vous demandez la
        synchronisation.
      </p>

      <H>Clés de fournisseurs d'IA</H>
      <p>
        Si vous connectez un modèle, la clé est chiffrée avec AES-256-GCM sous une clé maître du
        serveur (dérivée par HKDF). Elle n'est jamais renvoyée au navigateur, jamais journalisée ;
        seule une empreinte de 8 caractères est affichée pour vous permettre de vérifier quelle clé
        est en place.
      </p>

      <H>E-mails</H>
      <p>
        Les messages transactionnels (réinitialisation, vérification, support) sont journalisés dans
        une file interne avec leur statut de remise. Si aucun fournisseur d'e-mail n'est configuré,
        le message n'est pas envoyé et son statut indique explicitement cette absence.
      </p>

      <H>Ce que nous ne faisons pas</H>
      <p>
        Pas de régie publicitaire, pas de revendeur de données, pas de script d'analyse tiers, pas
        de profil comportemental. Les pages n'incluent aucun pixel externe.
      </p>

      <H>Durées de conservation</H>
      <p>
        Compte et résultats : tant que le compte existe. Jetons de réinitialisation : 1 heure.
        Jetons de vérification : 24 heures. Journaux techniques : 30 jours maximum. File d'e-mails :
        30 jours.
      </p>

      <H>Vos droits</H>
      <p>
        Accès, rectification, effacement, portabilité et opposition : écrivez à{" "}
        <em>[LEGAL_DPO_CONTACT]</em> ou passez par{" "}
        <Link to="/support" className="text-white underline">
          l'assistance
        </Link>
        . Une réponse intervient dans un délai de 30 jours.
      </p>

      <H>Responsable de traitement</H>
      <p>
        <em>[LEGAL_ENTITY_NAME]</em>, <em>[LEGAL_ADDRESS]</em>, immatriculée sous{" "}
        <em>[LEGAL_REGISTRATION]</em>.
      </p>
    </Shell>
  );
}

export function Cookies() {
  return (
    <Shell title="Cookies et stockage local" updated="novembre 2026">
      <p>
        Le service n'utilise qu'un cookie strictement nécessaire et un stockage local technique.
        Aucun cookie publicitaire ou de mesure d'audience tierce n'est déposé, donc aucun bandeau de
        consentement n'est requis — et aucun n'est affiché.
      </p>

      <H>Cookie de session</H>
      <p>
        <code className="rounded bg-white/10 px-1 py-0.5 text-[12px] text-white">
          proofcore_session
        </code>{" "}
        — jeton opaque,{" "}
        <code className="rounded bg-white/10 px-1 py-0.5 text-[12px] text-white">HttpOnly</code>,{" "}
        <code className="rounded bg-white/10 px-1 py-0.5 text-[12px] text-white">Secure</code> en
        HTTPS,{" "}
        <code className="rounded bg-white/10 px-1 py-0.5 text-[12px] text-white">SameSite=Lax</code>
        . Le serveur ne stocke que son empreinte SHA-256. Durée : 30 jours, renouvelée à chaque
        connexion.
      </p>

      <H>Stockage local</H>
      <p>
        Préférence de thème (clair/sombre) et langue de l'interface. Ces valeurs restent dans votre
        navigateur et ne sont jamais transmises.
      </p>

      <H>Ce qui n'est pas utilisé</H>
      <p>
        Aucun cookie de réseau publicitaire, aucun outil d'analyse comportementale, aucun
        enregistreur de session.
      </p>
    </Shell>
  );
}
