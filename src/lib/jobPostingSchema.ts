import { useEffect } from "react";
import type { PublicJobDetail } from "./publicJobsPreview";

// JR-0131 : balisage Schema.org JobPosting sur la fiche publique d'une
// offre (PublicJobDetailPage.tsx), condition d'entrée dans Google for Jobs.
//
// N'injecte le balisage que si les champs jugés nécessaires par Google pour
// un résultat riche valide sont réellement présents (title, company_name,
// description_excerpt, posted_at, et une localisation exploitable) —
// plutôt que d'émettre un JobPosting incomplet qui échouerait la
// validation. Le taux réel de complétude de ces champs sur le catalogue
// n'a pas été mesuré avant ce ticket ; certaines offres n'auront donc pas
// de balisage tant que leurs données sources restent incomplètes, ce qui
// est le comportement voulu.

const SITE_URL = "https://jobradar.go4jobapp.com";

function mapEmploymentType(contractType: string | null): string[] | undefined {
  if (!contractType) return undefined;
  const v = contractType.toLowerCase();
  const types: string[] = [];
  if (v.includes("full_time") || v.includes("full-time") || v.includes("temps plein")) types.push("FULL_TIME");
  if (v.includes("part_time") || v.includes("part-time") || v.includes("temps partiel")) types.push("PART_TIME");
  if (v.includes("contract") || v.includes("contractor") || v.includes("freelance")) types.push("CONTRACTOR");
  if (v.includes("temporary") || v.includes("intérim") || v.includes("interim")) types.push("TEMPORARY");
  if (v.includes("intern") || v.includes("stage")) types.push("INTERN");
  if (v.includes("volunteer") || v.includes("bénévolat")) types.push("VOLUNTEER");
  return types.length > 0 ? types : undefined;
}

function mapSalaryUnitText(period: string | null): string | undefined {
  if (!period) return undefined;
  const v = period.toLowerCase();
  if (v.includes("hour") || v.includes("heure")) return "HOUR";
  if (v.includes("day") || v.includes("jour")) return "DAY";
  if (v.includes("week") || v.includes("semaine")) return "WEEK";
  if (v.includes("month") || v.includes("mois")) return "MONTH";
  if (v.includes("year") || v.includes("an")) return "YEAR";
  return undefined;
}

function isFullyRemote(remoteType: string | null): boolean {
  if (!remoteType) return false;
  const v = remoteType.toLowerCase();
  return v.includes("remote") && !v.includes("hybrid");
}

/**
 * Construit le JSON-LD JobPosting, ou null si les données ne sont pas
 * suffisantes pour un résultat riche valide.
 */
export function buildJobPostingSchema(job: PublicJobDetail): Record<string, unknown> | null {
  if (!job.title || !job.company_name || !job.description_excerpt || !job.posted_at) return null;

  const remote = isFullyRemote(job.remote_type);
  if (!remote && !job.location) return null;

  const schema: Record<string, unknown> = {
    "@context": "https://schema.org/",
    "@type": "JobPosting",
    title: job.title,
    description: job.description_excerpt,
    datePosted: job.posted_at,
    hiringOrganization: {
      "@type": "Organization",
      name: job.company_name,
    },
    url: `${SITE_URL}/offres/${job.id}`,
  };

  if (remote) {
    schema.jobLocationType = "TELECOMMUTE";
    schema.applicantLocationRequirements = {
      "@type": "Country",
      name: job.country || "Monde",
    };
  } else {
    schema.jobLocation = {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressLocality: job.location,
        addressCountry: job.country_codes?.[0]?.toUpperCase() || job.country || undefined,
      },
    };
  }

  const employmentType = mapEmploymentType(job.contract_type);
  if (employmentType) schema.employmentType = employmentType;

  const unitText = mapSalaryUnitText(job.salary_period);
  if (job.salary_currency && unitText && (job.salary_min || job.salary_max)) {
    const value: Record<string, unknown> =
      job.salary_min && job.salary_max && job.salary_min !== job.salary_max
        ? { "@type": "QuantitativeValue", minValue: job.salary_min, maxValue: job.salary_max, unitText }
        : { "@type": "QuantitativeValue", value: job.salary_min ?? job.salary_max, unitText };
    schema.baseSalary = {
      "@type": "MonetaryAmount",
      currency: job.salary_currency,
      value,
    };
  }

  return schema;
}

const SCRIPT_ID = "jobposting-jsonld";

export function useJobPostingSchema(job: PublicJobDetail | null) {
  useEffect(() => {
    const schema = job ? buildJobPostingSchema(job) : null;
    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;

    if (!schema) {
      if (script) script.remove();
      return;
    }

    if (!script) {
      script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.type = "application/ld+json";
      document.head.appendChild(script);
    }
    script.textContent = JSON.stringify(schema);

    return () => {
      script?.remove();
    };
  }, [job]);
}
