import { supabase } from "./supabaseClient";
import type { OnboardingAlertDraft } from "./jobradarOnboarding";

export type OnboardingAlertResult = {
  id: string;
  name: string;
  keywords: string[];
  countries: string[] | null;
  frequency: string;
};

function primaryKeywords(desiredRole: string, drafts: OnboardingAlertDraft[]): string[] {
  if (drafts.length && drafts[0].keywords.length) return drafts[0].keywords;
  const role = desiredRole.trim();
  return role ? [role] : [];
}

function primaryCountries(countryCodes: string[], drafts: OnboardingAlertDraft[]): string[] | null {
  if (drafts.length && drafts[0].countries !== undefined) {
    return drafts[0].countries && drafts[0].countries.length ? drafts[0].countries : null;
  }
  if (!countryCodes.length) return null;
  if (countryCodes.includes("ALL")) return null;
  return countryCodes;
}

/**
 * Cree ou met a jour, de maniere idempotente (contrainte unique cote base,
 * voir migration 20260724100000), l'alerte gratuite issue du consentement
 * explicite donne sur l'ecran Preferences de l'onboarding JobRadar.
 *
 * Ne doit etre appelee qu'apres un clic sur un bouton dont le texte
 * disclose deja qu'une alerte va etre creee (Ajustement 1 de la
 * specification activation/paiement du 24/07/2026) : cette fonction ne
 * gere pas elle-meme le consentement, elle suppose qu'il a deja ete donne.
 *
 * Echoue "doucement" : en cas d'erreur ou de donnees insuffisantes, elle
 * retourne null plutot que de lever une exception, pour ne jamais bloquer
 * la progression dans l'onboarding a cause d'un souci sur cette alerte.
 */
export async function activateOnboardingAlert(params: {
  desiredRole: string;
  countryCodes: string[];
  alertDrafts: OnboardingAlertDraft[];
  frequency?: string;
}): Promise<OnboardingAlertResult | null> {
  const keywords = primaryKeywords(params.desiredRole, params.alertDrafts);
  if (!keywords.length) return null;

  const countries = primaryCountries(params.countryCodes, params.alertDrafts);
  const name = params.alertDrafts[0]?.name || params.desiredRole.trim() || "Mon alerte JobRadar";
  const frequency = params.frequency ?? params.alertDrafts[0]?.frequency ?? "daily";

  try {
    const { data, error } = await supabase.rpc("jobradar_upsert_onboarding_alert", {
      p_name: name,
      p_keywords: keywords,
      p_countries: countries,
      p_frequency: frequency,
    });

    if (error) {
      console.error("activateOnboardingAlert: RPC error", error.message);
      return null;
    }

    return (data as OnboardingAlertResult) ?? null;
  } catch (err) {
    console.error("activateOnboardingAlert: unexpected error", err);
    return null;
  }
}
