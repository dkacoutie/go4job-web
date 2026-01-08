// src/lib/taxonomy.ts
// Taxonomie v1 FR+EN (petite mais efficace). On enrichira au fur et à mesure.

export type Taxonomy = {
  skills: Record<string, string[]>; // canonical -> synonyms (FR+EN + variantes)
  roles: Record<string, string[]>; // canonical -> synonyms
};

export const taxonomyV1: Taxonomy = {
  skills: {
    // DATA / BI
    sql: ["sql", "postgres", "postgresql", "mysql", "mssql", "sql server", "t-sql"],
    "power bi": ["power bi", "powerbi", "pbi", "dax", "power query"],
    excel: ["excel", "ms excel", "microsoft excel", "tableur", "vba"],
    tableau: ["tableau", "tableau software"],
    python: ["python", "py", "pandas", "numpy"],
    "data analysis": ["data analysis", "analyse de données", "analyse des données", "analytics", "reporting"],

    // DEV
    javascript: ["javascript", "js", "ecmascript"],
    typescript: ["typescript", "ts"],
    react: ["react", "reactjs", "react.js"],
    "node.js": ["node", "nodejs", "node.js"],
    api: ["api", "rest", "rest api", "graphql"],

    // PM / AGILE
    "project management": ["project management", "gestion de projet", "gestion de projets", "pm"],
    scrum: ["scrum", "scrum master", "scrum mastering"],
    agile: ["agile", "agilité", "agile methodology", "méthode agile", "kanban"],

    // FINANCE / SALES (exemples)
    accounting: ["accounting", "comptabilité", "compta"],
    sales: ["sales", "vente", "ventes", "business development", "bd", "commercial"],
  },

  roles: {
    // DATA
    "data analyst": [
      "data analyst",
      "analyste data",
      "analyste de données",
      "analyste données",
      "bi analyst",
      "analyste bi",
    ],
    "data engineer": ["data engineer", "ingénieur data", "ingenieur data", "data pipeline engineer"],

    // DEV
    "frontend developer": [
      "frontend developer",
      "front-end developer",
      "développeur front-end",
      "developpeur front end",
      "développeur frontend",
    ],
    "full stack developer": [
      "full stack developer",
      "fullstack developer",
      "développeur fullstack",
      "developpeur full stack",
    ],

    // PM
    "project manager": [
      "project manager",
      "chef de projet",
      "cheffe de projet",
      "pm",
      "gestionnaire de projet",
      "programme manager",
      "program manager",
    ],
    "product manager": ["product manager", "chef de produit", "product owner", "po"],

    // FINANCE / SALES
    accountant: ["accountant", "comptable", "responsable comptable"],
    "sales representative": ["sales representative", "commercial", "chargé commercial", "charge commercial", "sales exec"],
  },
};

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Remplace les synonymes FR/EN par leurs formes "canoniques".
 * Ex: "chef de projet" -> "project manager", "powerbi" -> "power bi"
 */
export function canonicalizeText(input: string, tax: Taxonomy = taxonomyV1): string {
  let text = (input ?? "").toLowerCase();

  const replaceFrom = (dict: Record<string, string[]>) => {
    for (const [canonical, syns] of Object.entries(dict)) {
      const variants = [canonical, ...(syns ?? [])]
        .map((x) => x.toLowerCase().trim())
        .filter(Boolean);

      for (const v of variants) {
        // Remplace uniquement sur frontières de mots (évite les collisions)
        const re = new RegExp(`\\b${escapeRegExp(v)}\\b`, "g");
        text = text.replace(re, canonical);
      }
    }
  };

  // Ordre important : rôles puis skills
  replaceFrom(tax.roles);
  replaceFrom(tax.skills);

  return text;
}
