import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";
import { useSession } from "./lib/useSession";
import "./JobDetailsPage.css";

type ApplicationStatus = "saved" | "queued" | "in_progress" | "submitted" | "failed";

type JobRow = {
  id: string;
  title?: string | null;
  company_name?: string | null;
  location?: string | null;
  country?: string | null;
  remote_type?: string | null;

  apply_url?: string | null;
  source_url?: string | null;

  description_text?: string | null;
  description_html?: string | null;

  sort_at?: string | null;
  published_at?: string | null;
  posted_at?: string | null;
  scraped_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type AppRow = {
  id: number;
  job_id: string;
  status: ApplicationStatus;
  created_at: string | null;
  submitted_at?: string | null;
  error_message?: string | null;
};

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const maybeMessage = (err as { message?: unknown }).message;
    if (typeof maybeMessage === "string") return maybeMessage;
  }
  return String(err);
}

function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
  );
}

function statusLabel(s: ApplicationStatus) {
  switch (s) {
    case "saved":
      return "À postuler";
    case "queued":
      return "En file";
    case "in_progress":
      return "En cours";
    case "submitted":
      return "Envoyée";
    case "failed":
      return "Échouée";
    default:
      return s;
  }
}

function statusClass(s: ApplicationStatus) {
  return s === "saved"
    ? "chipQueued"
    : s === "queued"
    ? "chipQueued"
    : s === "in_progress"
    ? "chipInProgress"
    : s === "submitted"
    ? "chipSubmitted"
    : "chipFailed";
}

function firstDate(job: JobRow) {
  const candidates = [
    job.published_at,
    job.posted_at,
    job.sort_at,
    job.scraped_at,
    job.created_at,
    job.updated_at,
  ].filter(Boolean) as string[];

  for (const d of candidates) {
    const t = Date.parse(d);
    if (!Number.isNaN(t)) return new Date(t);
  }
  return null;
}

/**
 * Sanitizer côté navigateur :
 * - supprime script/style/iframe/object/embed/link/meta/noscript
 * - supprime attributs on*
 * - supprime href/src dangereux (javascript:, data:)
 */
function sanitizeHtmlBasic(html: string): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html ?? "", "text/html");

    const badSelectors = "script,style,iframe,object,embed,link,meta,noscript";
    doc.querySelectorAll(badSelectors).forEach((n) => n.remove());

    const all = doc.body.querySelectorAll<HTMLElement>("*");
    all.forEach((el) => {
      [...el.attributes].forEach((attr) => {
        const name = attr.name.toLowerCase();
        const value = (attr.value ?? "").trim().toLowerCase();

        if (name.startsWith("on")) {
          el.removeAttribute(attr.name);
          return;
        }

        if (
          (name === "href" || name === "src") &&
          (value.startsWith("javascript:") || value.startsWith("data:"))
        ) {
          el.removeAttribute(attr.name);
          return;
        }
      });

      if (el.tagName.toLowerCase() === "a") {
        el.setAttribute("rel", "noopener noreferrer");
        el.setAttribute("target", "_blank");
      }
    });

    return doc.body.innerHTML;
  } catch {
    return (html ?? "")
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "");
  }
}

function stripHtmlToText(html: string): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html ?? "", "text/html");
    return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
  } catch {
    return (html ?? "")
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
      .replace(/<\/?[^>]+(>|$)/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
}

function clampStr(s: string, max = 240) {
  const t = (s ?? "").trim();
  if (t.length <= max) return t;
  return t.slice(0, max).trim() + "…";
}

function normText(s: string) {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function includesAny(hay: string, words: string[]) {
  for (const w of words) if (hay.includes(w)) return true;
  return false;
}

type FamilyId =
  | "software_it"
  | "data_ai"
  | "design_product"
  | "marketing_growth"
  | "sales_support"
  | "finance_accounting"
  | "hr_admin"
  | "legal_compliance"
  | "operations_project"
  | "supply_chain_logistics"
  | "construction_trades"
  | "manufacturing_engineering"
  | "healthcare"
  | "education_training"
  | "aviation_transport";

type FamilyTemplate = {
  id: FamilyId;
  label: string;
  keywordsHint?: string;
  missions: string[];
  profile: string[];
  checklist: string[];
  extraSkills?: string[];
};

const FAMILY_TEMPLATES: Record<FamilyId, FamilyTemplate> = {
  software_it: {
    id: "software_it",
    label: "Informatique / Développement",
    keywordsHint: "developer, software, frontend, backend, devops, sysadmin…",
    missions: [
      "Développer, tester et maintenir des fonctionnalités (qualité, performance, sécurité).",
      "Collaborer avec produit/design pour livrer des itérations rapides.",
      "Participer au code review, à la documentation et à la résolution d’incidents.",
    ],
    profile: [
      "Bonne maîtrise d’au moins une stack (ex: JS/TS, Python, Java, Go…).",
      "Connaissance Git, tests, bonnes pratiques (sécurité, performance).",
      "Capacité à analyser un bug et proposer une solution propre.",
    ],
    checklist: [
      "Préparer 2–3 projets/PRs à montrer (GitHub, démos, captures).",
      "Lister les technos exactes demandées sur l’annonce source.",
      "Mettre en avant impact (latence, coûts, fiabilité, users).",
    ],
    extraSkills: ["typescript", "react", "node", "python", "sql", "docker", "kubernetes", "aws", "gcp"],
  },

  data_ai: {
    id: "data_ai",
    label: "Data / IA",
    keywordsHint: "data analyst, data scientist, ml, ai, analytics…",
    missions: [
      "Analyser des données, produire des insights et des indicateurs fiables.",
      "Construire/maintenir des pipelines et/ou des modèles (selon le rôle).",
      "Travailler avec les équipes métier pour répondre à des questions concrètes.",
    ],
    profile: [
      "Solide base en SQL + analyse (Excel/BI) ou Python selon le poste.",
      "Capacité à expliquer clairement les résultats à des non-techniciens.",
      "Rigueur sur la qualité des données (sources, biais, validation).",
    ],
    checklist: [
      "Préparer 1–2 études de cas (dashboard, analyse, modèle) avec résultats.",
      "Mettre en avant métriques business (revenu, conversion, churn…).",
      "Vérifier l’outillage demandé (Power BI/Tableau, dbt, Airflow…).",
    ],
    extraSkills: ["sql", "python", "power bi", "tableau", "dbt", "airflow", "ml", "statistics"],
  },

  design_product: {
    id: "design_product",
    label: "Design / Produit",
    keywordsHint: "product, ux, ui, designer, figma, product manager…",
    missions: [
      "Comprendre le besoin utilisateur et définir une solution utilisable.",
      "Concevoir des parcours, maquettes, spécifications et itérations.",
      "Mesurer l’impact (qualité, adoption) et améliorer en continu.",
    ],
    profile: [
      "Bon sens produit/UX, capacité à prioriser et simplifier.",
      "Portfolio ou exemples de livrables (maquettes, flows, specs).",
      "Communication claire avec dev, stakeholders et utilisateurs.",
    ],
    checklist: [
      "Préparer 2–3 cas concrets (problème → solution → résultat).",
      "Relire l’annonce source pour l’orientation (UX vs UI vs PM).",
      "Mettre en avant méthode (research, tests, A/B, discovery).",
    ],
    extraSkills: ["figma", "wireframe", "prototype", "user research", "roadmap"],
  },

  marketing_growth: {
    id: "marketing_growth",
    label: "Marketing / Growth / Contenu",
    keywordsHint: "marketing, growth, content, seo, social media…",
    missions: [
      "Créer/exécuter des campagnes (acquisition, contenu, email, social).",
      "Analyser performances (CAC, conversion, trafic) et optimiser.",
      "Travailler la marque et la cohérence des messages.",
    ],
    profile: [
      "Capacité à produire du contenu orienté résultat (lead, ventes, notoriété).",
      "Aisance avec outils (Meta/Google Ads, SEO, CRM) selon le poste.",
      "Compétences rédactionnelles et esprit analytique.",
    ],
    checklist: [
      "Préparer un mini-portfolio (posts, newsletters, landing pages).",
      "Chiffrer les résultats passés (CTR, leads, ROAS, trafic).",
      "Comprendre la cible et proposer 2–3 idées d’amélioration.",
    ],
    extraSkills: ["seo", "copywriting", "ads", "crm", "email marketing", "analytics"],
  },

  sales_support: {
    id: "sales_support",
    label: "Vente / Customer Success / Support",
    keywordsHint: "sales, account, business development, support, success…",
    missions: [
      "Gérer un pipeline (prospection, qualification, closing) ou un portefeuille.",
      "Assurer la satisfaction client (onboarding, suivi, résolution).",
      "Atteindre des objectifs (quota, rétention, upsell).",
    ],
    profile: [
      "Excellent relationnel + capacité à convaincre et négocier.",
      "Organisation (CRM, suivi, relances) et orientation résultat.",
      "Capacité à comprendre le produit pour bien répondre aux besoins.",
    ],
    checklist: [
      "Préparer 2–3 histoires de deals/résolutions difficiles (STAR).",
      "Mettre en avant chiffres (MRR, taux de conversion, NPS, churn).",
      "Relire l’annonce pour le segment (B2B/B2C, enterprise/SMB).",
    ],
    extraSkills: ["crm", "salesforce", "hubspot", "negotiation", "customer success"],
  },

  finance_accounting: {
    id: "finance_accounting",
    label: "Finance / Comptabilité / Audit",
    keywordsHint: "finance, accounting, audit, tax, controller…",
    missions: [
      "Produire/contrôler des états financiers et analyses (mensuel, clôture).",
      "Suivre budget, cash, KPI et recommandations de performance.",
      "Assurer conformité fiscale/audit et amélioration des processus.",
    ],
    profile: [
      "Maîtrise comptabilité/finance (selon rôle) + rigueur documentaire.",
      "Aisance Excel/Sheets; ERP est un plus (SAP, Odoo…).",
      "Capacité à expliquer les chiffres et risques aux décideurs.",
    ],
    checklist: [
      "Préparer exemples de tableaux (reporting, budget, cashflow).",
      "Mettre en avant conformité, contrôle interne, fiabilité.",
      "Lire l’annonce pour normes attendues (IFRS, local GAAP).",
    ],
    extraSkills: ["excel", "budget", "cashflow", "audit", "ifrs", "tax"],
  },

  hr_admin: {
    id: "hr_admin",
    label: "RH / Administration",
    keywordsHint: "hr, recruiter, talent, admin, office manager…",
    missions: [
      "Gérer recrutement, onboarding, suivi RH et dossiers administratifs.",
      "Assurer la conformité (contrats, paie, procédures) selon le rôle.",
      "Améliorer l’expérience employé et l’organisation interne.",
    ],
    profile: [
      "Sens de la confidentialité, rigueur et très bonne organisation.",
      "Aisance communication + capacité à gérer plusieurs priorités.",
      "Connaissance outils RH/administratifs (selon contexte).",
    ],
    checklist: [
      "Préparer exemples (process recrutement, onboarding, reporting RH).",
      "Mettre en avant fiabilité, discrétion, qualité de service.",
      "Lire l’annonce pour scope (RH généraliste vs recrutement vs admin).",
    ],
    extraSkills: ["recruitment", "onboarding", "hris", "payroll", "admin"],
  },

  legal_compliance: {
    id: "legal_compliance",
    label: "Juridique / Compliance",
    keywordsHint: "legal, compliance, contract, regulatory, risk…",
    missions: [
      "Rédiger/revoir des contrats et sécuriser les risques juridiques.",
      "Assurer conformité réglementaire et procédures internes.",
      "Former/guider les équipes sur les bonnes pratiques.",
    ],
    profile: [
      "Très bonne capacité d’analyse et de rédaction juridique.",
      "Rigueur, confidentialité, sens du risque.",
      "Capacité à travailler avec des non-juristes de façon pragmatique.",
    ],
    checklist: [
      "Préparer 2–3 exemples (contrats, policies, cas de conformité).",
      "Lire l’annonce pour secteur (finance, santé, tech…) et normes.",
      "Mettre en avant gestion des risques et approche business-friendly.",
    ],
    extraSkills: ["contracts", "gdpr", "risk", "compliance", "policy"],
  },

  operations_project: {
    id: "operations_project",
    label: "Opérations / Gestion de projet",
    keywordsHint: "operations, project manager, program, delivery…",
    missions: [
      "Piloter un projet (planning, budget, qualité) et coordonner les équipes.",
      "Mettre en place des process, améliorer l’efficacité et le reporting.",
      "Gérer risques, dépendances et communication stakeholders.",
    ],
    profile: [
      "Organisation, leadership, communication + capacité à prioriser.",
      "Méthodes projet (Agile/Waterfall) selon contexte.",
      "Aisance avec outils (Sheets, Jira, Notion, MS Project…).",
    ],
    checklist: [
      "Préparer 2 projets (contexte → actions → résultat mesurable).",
      "Montrer capacité à résoudre problèmes et gérer pression.",
      "Relire l’annonce pour scope (PMO, delivery, ops, program).",
    ],
    extraSkills: ["agile", "scrum", "jira", "planning", "kpi", "stakeholders"],
  },

  supply_chain_logistics: {
    id: "supply_chain_logistics",
    label: "Supply chain / Logistique",
    keywordsHint: "logistics, supply chain, warehouse, procurement…",
    missions: [
      "Planifier approvisionnements, stocks, livraisons et coûts.",
      "Coordonner fournisseurs/transport et résoudre les incidents.",
      "Améliorer le service (délais, taux de service, ruptures).",
    ],
    profile: [
      "Rigueur, réactivité et capacité à travailler avec plusieurs acteurs.",
      "Aisance tableaux de bord (stocks, prévisions, OTIF).",
      "Connaissance des procédures et conformité (selon secteur).",
    ],
    checklist: [
      "Préparer des exemples KPI (rupture, lead time, taux de service).",
      "Mettre en avant optimisations (coûts, délais, fiabilité).",
      "Lire l’annonce pour périmètre (achat, transport, entrepôt).",
    ],
    extraSkills: ["procurement", "inventory", "warehouse", "otif", "forecast"],
  },

  construction_trades: {
    id: "construction_trades",
    label: "BTP / Artisanat",
    keywordsHint: "menuisier, maçon, électricien, plombier, chantier…",
    missions: [
      "Réaliser les travaux selon plans/normes et assurer la qualité des finitions.",
      "Préparer le chantier (matériel, sécurité, organisation) et respecter les délais.",
      "Diagnostiquer des problèmes et proposer des solutions sur le terrain.",
    ],
    profile: [
      "Expérience métier (atelier/chantier) + respect strict des règles sécurité.",
      "Capacité à lire un plan / prendre des mesures / travailler proprement.",
      "Fiabilité, ponctualité, sens du détail et travail d’équipe.",
    ],
    checklist: [
      "Préparer photos/portfolio (avant/après) ou liste de réalisations.",
      "Mettre en avant sécurité, qualité, respect des délais.",
      "Vérifier si permis/certifications/outillage sont requis.",
    ],
    extraSkills: ["menuiserie", "charpente", "electricite", "plomberie", "chantier", "securite"],
  },

  manufacturing_engineering: {
    id: "manufacturing_engineering",
    label: "Industrie / Ingénierie / Production",
    keywordsHint: "engineer, maintenance, production, quality, plant…",
    missions: [
      "Assurer la production/maintenance/qualité selon le rôle et les standards.",
      "Analyser incidents, améliorer process (sécurité, coût, rendement).",
      "Documenter procédures et contribuer à l’amélioration continue.",
    ],
    profile: [
      "Base technique solide (mécanique, électrique, process, qualité…).",
      "Rigueur HSE, esprit d’analyse, capacité à diagnostiquer.",
      "Aisance avec procédures, reporting et travail terrain.",
    ],
    checklist: [
      "Préparer exemples d’améliorations (rendement, pannes, défauts).",
      "Mettre en avant sécurité et respect des standards.",
      "Lire l’annonce pour normes/outils (ISO, Lean, 5S…).",
    ],
    extraSkills: ["maintenance", "lean", "quality", "hse", "iso", "production"],
  },

  healthcare: {
    id: "healthcare",
    label: "Santé",
    keywordsHint: "infirmier, médecin, pharmacien, clinique…",
    missions: [
      "Prendre en charge des patients/clients avec qualité, empathie et sécurité.",
      "Appliquer les protocoles, tracer les actes et gérer les risques.",
      "Collaborer avec l’équipe et assurer la continuité des soins/services.",
    ],
    profile: [
      "Formation/certification requise selon métier + respect des protocoles.",
      "Rigueur, confidentialité, capacité à travailler sous pression.",
      "Bon relationnel et sens du service.",
    ],
    checklist: [
      "Préparer diplômes/inscriptions/autorisation d’exercer si requis.",
      "Mettre en avant expérience concrète (services, actes, urgences).",
      "Lire l’annonce pour horaires, garde, service spécifique.",
    ],
    extraSkills: ["protocoles", "patients", "pharmacie", "clinique", "soins"],
  },

  education_training: {
    id: "education_training",
    label: "Éducation / Formation",
    keywordsHint: "teacher, trainer, instructor, education…",
    missions: [
      "Concevoir et animer des cours/ateliers adaptés au niveau des apprenants.",
      "Évaluer la progression et ajuster la pédagogie.",
      "Créer du contenu pédagogique et assurer un cadre positif.",
    ],
    profile: [
      "Bonne pédagogie, patience, capacité à expliquer simplement.",
      "Préparation de cours et organisation (supports, exercices).",
      "Capacité à gérer une classe/groupe et à motiver.",
    ],
    checklist: [
      "Préparer des exemples de supports (plan de cours, exercices).",
      "Mettre en avant résultats (progression, réussite, feedback).",
      "Lire l’annonce pour public (enfants, adultes, pro, en ligne).",
    ],
    extraSkills: ["pedagogie", "formation", "cours", "evaluation"],
  },

  aviation_transport: {
    id: "aviation_transport",
    label: "Aviation / Transport",
    keywordsHint: "pilot, flight, captain, driver, transport…",
    missions: [
      "Assurer des opérations de transport en respectant procédures et sécurité.",
      "Préparer la mission (briefing, vérifications, documentation) selon le rôle.",
      "Coordonner avec l’équipe et communiquer en situation normale/dégradée.",
    ],
    profile: [
      "Permis/certifications obligatoires selon métier (très important).",
      "Rigueur sécurité, discipline, respect strict des procédures.",
      "Bonne gestion du stress et communication claire.",
    ],
    checklist: [
      "Vérifier permis, licences, médical, heures, habilitations requises.",
      "Préparer historique sécurité/discipline et exemples de situations gérées.",
      "Lire l’annonce pour type de véhicule/route/horaire/fuseau.",
    ],
    extraSkills: ["safety", "procedures", "license", "transport", "operations"],
  },
};

function detectFamily(job: JobRow): { family: FamilyTemplate; why: string } {
  const hay = normText([job.title, job.company_name, job.location, job.country, job.remote_type].filter(Boolean).join(" "));

  const rules: Array<{ id: FamilyId; keys: string[] }> = [
    // Aviation/Transport
    { id: "aviation_transport", keys: ["pilot", "pilote", "flight", "captain", "aviation", "airline", "driver", "chauffeur", "transport"] },

    // Santé
    { id: "healthcare", keys: ["infirm", "nurse", "doctor", "medec", "pharmac", "clinic", "clinique", "hospital", "sage-femme", "midwife"] },

    // BTP / Artisanat
    { id: "construction_trades", keys: ["menuis", "charpent", "macon", "maçon", "plomb", "electric", "électric", "peintre", "carreleur", "chantier", "artisan"] },

    // Industrie / Ingénierie
    { id: "manufacturing_engineering", keys: ["engineer", "ingenieur", "ingénieur", "maintenance", "production", "factory", "plant", "quality", "qa", "qc", "lean", "hse"] },

    // Supply / Logistique
    { id: "supply_chain_logistics", keys: ["logistic", "supply", "warehouse", "entrepot", "entrepôt", "procurement", "achat", "inventory", "stock", "fleet"] },

    // Juridique / Compliance
    { id: "legal_compliance", keys: ["legal", "jurid", "compliance", "conform", "contract", "contrat", "regulatory", "gdpr", "risk officer"] },

    // Finance / Comptabilité
    { id: "finance_accounting", keys: ["finance", "account", "compta", "audit", "tax", "controller", "controle", "contrôl", "treasury", "cash"] },

    // RH / Admin
    { id: "hr_admin", keys: ["hr", "human resources", "recruit", "talent", "rh", "administrat", "office manager", "assistant", "secretaire", "secrétaire"] },

    // Marketing / Growth
    { id: "marketing_growth", keys: ["marketing", "growth", "seo", "content", "copy", "social", "community", "brand", "communication", "ads"] },

    // Sales / Support / CS
    { id: "sales_support", keys: ["sales", "account manager", "business development", "bdm", "support", "customer", "success", "call center", "service client"] },

    // Design / Produit
    { id: "design_product", keys: ["product manager", "pm ", " ux", "ui", "designer", "figma", "product owner", "roadmap"] },

    // Data / IA
    { id: "data_ai", keys: ["data", "analytics", "analyst", "scientist", "machine learning", "ml", "ai", "bi", "power bi", "tableau"] },

    // Software / IT
    { id: "software_it", keys: ["developer", "software", "frontend", "backend", "devops", "sysadmin", "network", "cloud", "react", "node", "java", "python", "golang"] },

    // Education
    { id: "education_training", keys: ["teacher", "prof", "professeur", "trainer", "training", "formation", "instructor", "education", "tutor"] },

    // Operations / Projet
    { id: "operations_project", keys: ["operations", "project", "program", "pmo", "delivery", "coordinator", "coordonnateur", "manager"] },
  ];

  for (const r of rules) {
    if (includesAny(hay, r.keys)) {
      return { family: FAMILY_TEMPLATES[r.id], why: `mots-clés: ${r.keys.find((k) => hay.includes(k)) ?? "match"}` };
    }
  }

  // fallback
  return { family: FAMILY_TEMPLATES.operations_project, why: "fallback par défaut" };
}

function buildAiFallback(job: JobRow) {
  const title = (job.title ?? "Ce poste").trim();
  const company = (job.company_name ?? "").trim();
  const loc = (job.location ?? job.country ?? "").trim();
  const remote = (job.remote_type ?? "").trim();

  const { family, why } = detectFamily(job);

  const subtitleParts = [company ? company : null, loc ? loc : null, remote ? remote : null].filter(Boolean);

  return {
    title: "Résumé Go4Job (IA) — description non officielle",
    subtitle: subtitleParts.length ? subtitleParts.join(" · ") : null,
    familyLabel: family.label,
    familyWhy: why,
    disclaimer:
      "La description officielle du recruteur n’est pas disponible pour cette offre. Ce contenu est généré automatiquement pour t’aider à comprendre le poste. Vérifie toujours les exigences sur l’annonce source.",
    missions: family.missions.map((m) => m.replace("selon le rôle", `pour un poste de type “${clampStr(title, 90)}”`)),
    profile: family.profile,
    checklist: family.checklist,
    hint: family.keywordsHint ?? "",
  };
}

export default function JobDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { session, loading } = useSession();
  const userId = session?.user?.id ?? null;

  const [job, setJob] = useState<JobRow | null>(null);
  const [app, setApp] = useState<AppRow | null>(null);

  const [busy, setBusy] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !session) navigate("/auth", { replace: true });
  }, [loading, session, navigate]);

  const load = async (isActive: () => boolean = () => true) => {
    if (!id) return;

    if (!isUuid(id)) {
      if (!isActive()) return;
      setJob(null);
      setApp(null);
      setBusy(false);
      setErrorMsg("ID d’offre invalide (UUID attendu).");
      return;
    }

    if (!isActive()) return;
    setBusy(true);
    setErrorMsg(null);

    try {
      const { data: jData, error: jErr } = await supabase
        .from("jobs")
        .select(
          `
          id,
          title,
          company_name,
          location,
          country,
          remote_type,
          apply_url,
          source_url,
          description_text,
          description_html,
          sort_at,
          published_at,
          posted_at,
          scraped_at,
          created_at,
          updated_at
        `
        )
        .eq("id", id)
        .maybeSingle();

      if (jErr) throw jErr;
      if (isActive()) setJob((jData ?? null) as JobRow | null);

      if (userId) {
        const { data: aData, error: aErr } = await supabase
          .from("applications")
          .select("id, job_id, status, created_at, submitted_at, error_message")
          .eq("user_id", userId)
          .eq("job_id", id)
          .maybeSingle();

        if (aErr) throw aErr;
        if (isActive()) setApp((aData ?? null) as AppRow | null);
      } else if (isActive()) {
        setApp(null);
      }
    } catch (error: unknown) {
      if (isActive()) setErrorMsg(getErrorMessage(error) ?? "Erreur inconnue");
    } finally {
      if (isActive()) setBusy(false);
    }
  };

  useEffect(() => {
    if (loading || !id) return;
    let active = true;
    load(() => active);
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, id, userId]);

  const date = useMemo(() => (job ? firstDate(job) : null), [job]);

  const applyLink = useMemo(() => {
    if (!job) return null;
    return job.apply_url || job.source_url || null;
  }, [job]);

  const desc = useMemo(() => {
    const text = (job?.description_text ?? "").trim();
    const htmlRaw = (job?.description_html ?? "").trim();
    const html = htmlRaw ? sanitizeHtmlBasic(htmlRaw) : "";
    const fallbackText = !text && html ? stripHtmlToText(html) : "";
    const ai = job ? buildAiFallback(job) : null;
    return { text, html, fallbackText, ai };
  }, [job]);

  async function postuler() {
    if (!id || !isUuid(id)) return;

    if (!userId) {
      navigate("/auth", { replace: true });
      return;
    }

    if (!applyLink) {
      setErrorMsg("Aucun lien de candidature (apply_url/source_url) n’est disponible pour cette offre.");
      return;
    }

    setActionBusy(true);
    setErrorMsg(null);

    try {
      const { error } = await supabase
        .from("applications")
        .upsert(
          { user_id: userId, job_id: id, status: "in_progress" as ApplicationStatus },
          { onConflict: "user_id,job_id" }
        );

      if (error) throw error;

      window.open(applyLink, "_blank", "noopener,noreferrer");
      await load();
    } catch (error: unknown) {
      setErrorMsg(getErrorMessage(error) ?? "Erreur inconnue");
    } finally {
      setActionBusy(false);
    }
  }

  async function removeFromList() {
    if (!userId || !id || !isUuid(id) || !app) return;

    setActionBusy(true);
    setErrorMsg(null);

    try {
      const { error } = await supabase.from("applications").delete().eq("user_id", userId).eq("job_id", id);
      if (error) throw error;
      setApp(null);
    } catch (error: unknown) {
      setErrorMsg(getErrorMessage(error) ?? "Erreur inconnue");
    } finally {
      setActionBusy(false);
    }
  }

  async function markSubmitted() {
    if (!userId || !id || !isUuid(id)) return;

    setActionBusy(true);
    setErrorMsg(null);

    try {
      const { error } = await supabase
        .from("applications")
        .update({ status: "submitted", submitted_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("job_id", id);

      if (error) throw error;
      await load();
    } catch (error: unknown) {
      setErrorMsg(getErrorMessage(error) ?? "Erreur inconnue");
    } finally {
      setActionBusy(false);
    }
  }

  function openSource() {
    if (!applyLink) return;
    window.open(applyLink, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="jd-shell">
      <main className="jd-main">
        <div className="jd-topbar">
          <button className="btn btnGhost" onClick={() => navigate(-1)} type="button">
            ← Retour
          </button>
          <button className="btn btnGhost" onClick={() => navigate("/jobradar/feed")} type="button">
            Feed JobRadar →
          </button>
        </div>

        {errorMsg && <div className="jd-error">Erreur : {errorMsg}</div>}

        {busy ? (
          <div className="jd-empty">Chargement de l’offre…</div>
        ) : !job ? (
          <div className="jd-empty">Offre introuvable.</div>
        ) : (
          <section className="jd-card">
            <div className="jd-head">
              <div>
                <h1 className="jd-title">{job.title ?? "Offre"}</h1>
                <div className="jd-sub">
                  {(job.company_name ?? "—") +
                    " · " +
                    (job.location ?? job.country ?? "—") +
                    (job.remote_type ? ` · ${job.remote_type}` : "")}
                </div>
              </div>

              <div className="jd-badges">
                {app && (
                  <span className={`chip chipStatus ${statusClass(app.status)}`}>{statusLabel(app.status)}</span>
                )}
                {date && <span className="chip jd-date">Publié : {date.toLocaleDateString()}</span>}
              </div>
            </div>

            <div className="jd-actions">
              <button className="btn btnPrimary" disabled={actionBusy} onClick={postuler} type="button">
                {actionBusy ? "Ouverture…" : "Postuler / Soumettre"}
              </button>

              <div className="jd-actionsRow">
                <button
                  className="btn btnGhost"
                  disabled={actionBusy}
                  onClick={markSubmitted}
                  title="Confirmer candidature envoyée"
                  type="button"
                >
                  Marquer envoyée
                </button>

                {app && (
                  <button className="btn btnGhost" disabled={actionBusy} onClick={removeFromList} type="button">
                    Retirer
                  </button>
                )}

                {applyLink && (
                  <button className="btn btnGhost" onClick={openSource} type="button" title="Ouvrir l’annonce source">
                    Voir l’annonce source ↗
                  </button>
                )}
              </div>

              <button className="btn btnGhost" onClick={() => navigate("/jobradar/applications")} type="button">
                Voir mes candidatures →
              </button>
            </div>

            <div className="jd-body">
              <h3>Description</h3>

              <div className="jd-desc">
                {/* 1) OFFICIEL (recruteur) */}
                {desc.html ? (
                  <div className="jd-html" dangerouslySetInnerHTML={{ __html: desc.html }} />
                ) : desc.text ? (
                  <div style={{ whiteSpace: "pre-wrap" }}>{desc.text}</div>
                ) : desc.fallbackText ? (
                  <div style={{ whiteSpace: "pre-wrap" }}>{desc.fallbackText}</div>
                ) : (
                  /* 2) FALLBACK IA PAR FAMILLE */
                  <div style={{ display: "grid", gap: 10 }}>
                    <div
                      style={{
                        padding: 12,
                        borderRadius: 14,
                        border: "1px solid rgba(0,0,0,0.08)",
                        background: "rgba(0,0,0,0.03)",
                      }}
                    >
                      <div style={{ fontWeight: 800 }}>{desc.ai?.title}</div>
                      {desc.ai?.subtitle && <div style={{ marginTop: 4, opacity: 0.8 }}>{desc.ai.subtitle}</div>}

                      <div style={{ marginTop: 8, fontSize: 13, opacity: 0.9 }}>
                        <strong>Famille détectée :</strong> {desc.ai?.familyLabel}
                        <span style={{ opacity: 0.7 }}> ({desc.ai?.familyWhy})</span>
                      </div>

                      <div style={{ marginTop: 8, fontSize: 13, opacity: 0.85 }}>{desc.ai?.disclaimer}</div>

                      {applyLink && (
                        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                          <button className="btn btnPrimary" type="button" onClick={openSource}>
                            Ouvrir l’annonce source ↗
                          </button>
                        </div>
                      )}
                    </div>

                    <div style={{ display: "grid", gap: 10 }}>
                      <div>
                        <div style={{ fontWeight: 800, marginBottom: 6 }}>Ce que tu feras probablement</div>
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {desc.ai?.missions.map((x, i) => (
                            <li key={i} style={{ marginBottom: 6 }}>
                              {x}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div>
                        <div style={{ fontWeight: 800, marginBottom: 6 }}>Profil recherché (indicatif)</div>
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {desc.ai?.profile.map((x, i) => (
                            <li key={i} style={{ marginBottom: 6 }}>
                              {x}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div>
                        <div style={{ fontWeight: 800, marginBottom: 6 }}>Checklist avant de postuler</div>
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {desc.ai?.checklist.map((x, i) => (
                            <li key={i} style={{ marginBottom: 6 }}>
                              {x}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <div className="jd-muted" style={{ fontSize: 13 }}>
                      Description officielle indisponible. (Nous essaierons de la récupérer automatiquement si possible.)
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
