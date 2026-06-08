import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import { usePass } from "./usePass";
import { useSession } from "./useSession";
import {
  type JobRadarOnboardingState,
  type JobRadarOnboardingStep,
  type JobRadarProfileRecord,
  EMPTY_JOBRADAR_ONBOARDING,
  hasPostPurchaseProfileCompleted,
  hasPreferencesCompleted,
  hasPrePurchaseProfileCompleted,
  mergeJobRadarOnboardingState,
  normalizeJobRadarOnboardingState,
} from "./jobradarOnboarding";

type Snapshot = {
  loading: boolean;
  profile: JobRadarProfileRecord | null;
  onboarding: JobRadarOnboardingState;
  hasActivePass: boolean;
  alertsCount: number;
  applicationsCount: number;
  hasCv: boolean;
  isNewUser: boolean;
  isOnboarded: boolean;
  legacyReady: boolean;
  profileCompletionReady: boolean;
  nextStep: JobRadarOnboardingStep;
};

function buildEmptySnapshot(loading: boolean): Snapshot {
  return {
    loading,
    profile: null,
    onboarding: EMPTY_JOBRADAR_ONBOARDING,
    hasActivePass: false,
    alertsCount: 0,
    applicationsCount: 0,
    hasCv: false,
    isNewUser: true,
    isOnboarded: false,
    legacyReady: false,
    profileCompletionReady: false,
    nextStep: "profile",
  };
}

function computeNextStep(params: {
  onboarding: JobRadarOnboardingState;
  hasActivePass: boolean;
  profileCompletionReady: boolean;
  hasCv: boolean;
  alertsCount: number;
  isOnboarded: boolean;
}) {
  if (params.isOnboarded) return "done" as const;
  if (!hasPrePurchaseProfileCompleted(params.onboarding)) return "profile" as const;
  if (!hasPreferencesCompleted(params.onboarding)) return "preferences" as const;
  if (!params.onboarding.previewSeenAt) return "preview" as const;
  if (!params.hasActivePass) return "unlock" as const;
  if (!params.profileCompletionReady) return "complete-profile" as const;
  if (!params.hasCv) return "cv" as const;
  if (params.alertsCount === 0) return "alerts" as const;
  return "done" as const;
}

export function useJobRadarOnboarding() {
  const { session, loading: sessionLoading } = useSession();
  const { hasActivePass, isLoadingPass } = usePass();
  const [snapshot, setSnapshot] = useState<Snapshot>(() => buildEmptySnapshot(true));
  const [saving, setSaving] = useState(false);
  const autoCompletedRef = useRef(false);

  const load = useCallback(async () => {
    if (!session?.user) {
      setSnapshot(buildEmptySnapshot(false));
      return;
    }

    const userId = session.user.id;
    const [{ data: profileData, error: profileError }, { count: alertsCount }, { count: applicationsCount }] =
      await Promise.all([
        supabase
          .from("profiles")
          .select(
            "user_id, full_name, phone, location, headline, experience_years, cv_file_path, cv_filename, cv_updated_at, jobradar_onboarding, jobradar_onboarding_completed_at"
          )
          .eq("user_id", userId)
          .maybeSingle(),
        supabase.from("alerts").select("id", { count: "exact", head: true }).eq("user_id", userId),
        supabase.from("applications").select("id", { count: "exact", head: true }).eq("user_id", userId),
      ]);

    let profile = (profileData as JobRadarProfileRecord | null) ?? null;
    if (!profile && !profileError) {
      const { data: created } = await supabase
        .from("profiles")
        .upsert({ user_id: userId }, { onConflict: "user_id" })
        .select(
          "user_id, full_name, phone, location, headline, experience_years, cv_file_path, cv_filename, cv_updated_at, jobradar_onboarding, jobradar_onboarding_completed_at"
        )
        .single();
      profile = (created as JobRadarProfileRecord | null) ?? null;
    }

    const onboarding = normalizeJobRadarOnboardingState(profile?.jobradar_onboarding ?? EMPTY_JOBRADAR_ONBOARDING);
    const hasCv = Boolean(profile?.cv_file_path);
    const profileCompletionReady = hasPostPurchaseProfileCompleted(profile);
    const explicitCompleted =
      Boolean(profile?.jobradar_onboarding_completed_at) || Boolean(onboarding.completedAt);
    const legacyReady = Boolean(hasActivePass || (alertsCount ?? 0) > 0 || (applicationsCount ?? 0) > 0);
    const isOnboarded = explicitCompleted || legacyReady;
    const nextStep = computeNextStep({
      onboarding,
      hasActivePass,
      profileCompletionReady,
      hasCv,
      alertsCount: alertsCount ?? 0,
      isOnboarded,
    });

    setSnapshot({
      loading: false,
      profile,
      onboarding,
      hasActivePass,
      alertsCount: alertsCount ?? 0,
      applicationsCount: applicationsCount ?? 0,
      hasCv,
      isNewUser: !explicitCompleted && !legacyReady && !hasPrePurchaseProfileCompleted(onboarding),
      isOnboarded,
      legacyReady,
      profileCompletionReady,
      nextStep,
    });
  }, [session?.user, hasActivePass]);

  useEffect(() => {
    if (sessionLoading || isLoadingPass) {
      setSnapshot((prev) => ({ ...prev, loading: true }));
      return;
    }
    void load();
  }, [sessionLoading, isLoadingPass, load]);

  const saveOnboarding = useCallback(
    async (patch: Partial<JobRadarOnboardingState>) => {
      if (!session?.user) return null;
      setSaving(true);
      const next = mergeJobRadarOnboardingState(snapshot.onboarding, patch);
      const { data, error } = await supabase
        .from("profiles")
        .update({ jobradar_onboarding: next })
        .eq("user_id", session.user.id)
        .select(
          "user_id, full_name, phone, location, headline, experience_years, cv_file_path, cv_filename, cv_updated_at, jobradar_onboarding, jobradar_onboarding_completed_at"
        )
        .single();
      setSaving(false);
      if (error) throw error;
      setSnapshot((prev) => ({
        ...prev,
        profile: (data as JobRadarProfileRecord) ?? prev.profile,
        onboarding: normalizeJobRadarOnboardingState((data as JobRadarProfileRecord)?.jobradar_onboarding ?? next),
      }));
      await load();
      return next;
    },
    [session?.user, snapshot.onboarding, load]
  );

  const markOnboardingComplete = useCallback(async () => {
    if (!session?.user) return;
    if (snapshot.isOnboarded && snapshot.profile?.jobradar_onboarding_completed_at) return;

    setSaving(true);
    const now = new Date().toISOString();
    const next = mergeJobRadarOnboardingState(snapshot.onboarding, {
      currentStep: "done",
      completedAt: now,
    });
    const { error } = await supabase
      .from("profiles")
      .update({
        jobradar_onboarding: next,
        jobradar_onboarding_completed_at: now,
      })
      .eq("user_id", session.user.id);
    setSaving(false);
    if (error) throw error;
    await load();
  }, [session?.user, snapshot.isOnboarded, snapshot.profile?.jobradar_onboarding_completed_at, snapshot.onboarding, load]);

  useEffect(() => {
    if (snapshot.loading || saving || autoCompletedRef.current) return;
    if (
      !snapshot.isOnboarded &&
      snapshot.hasActivePass &&
      snapshot.profileCompletionReady &&
      snapshot.hasCv &&
      snapshot.alertsCount > 0
    ) {
      autoCompletedRef.current = true;
      void markOnboardingComplete().finally(() => {
        autoCompletedRef.current = false;
      });
    }
  }, [
    snapshot.loading,
    saving,
    snapshot.isOnboarded,
    snapshot.hasActivePass,
    snapshot.profileCompletionReady,
    snapshot.hasCv,
    snapshot.alertsCount,
    markOnboardingComplete,
  ]);

  return useMemo(
    () => ({
      ...snapshot,
      loading: snapshot.loading || sessionLoading || isLoadingPass,
      saving,
      refresh: load,
      saveOnboarding,
      markOnboardingComplete,
    }),
    [snapshot, sessionLoading, isLoadingPass, saving, load, saveOnboarding, markOnboardingComplete]
  );
}
