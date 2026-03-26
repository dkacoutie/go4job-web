import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { buildJobRadarOnboardingHref } from "./jobradarOnboarding";
import { useJobRadarOnboarding } from "./useJobRadarOnboarding";

function Loader() {
  return (
    <div style={{ minHeight: "40vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ opacity: 0.75, fontWeight: 700 }}>Chargement…</div>
    </div>
  );
}

export default function JobRadarOnboardingGate({
  children,
  when = "protected",
}: {
  children: ReactNode;
  when?: "protected" | "home";
}) {
  const location = useLocation();
  const onboarding = useJobRadarOnboarding();

  if (onboarding.loading) return <Loader />;

  if (!onboarding.isOnboarded) {
    const target = buildJobRadarOnboardingHref(onboarding.nextStep);
    const alreadyOnboarding = location.pathname.startsWith("/jobradar/onboarding");
    if (!alreadyOnboarding && (when === "home" || onboarding.nextStep !== "done")) {
      return <Navigate to={target} replace />;
    }
  }

  return <>{children}</>;
}
