import { Suspense, lazy, useEffect, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate, Outlet } from "react-router-dom";

import ProtectedRoute from "./lib/ProtectedRoute";
import AdminRoute from "./lib/AdminRoute";
import JobRadarOnboardingGate from "./lib/JobRadarOnboardingGate";
import { useSession } from "./lib/useSession";

import AppLayout from "./AppLayout";
import PublicHeader from "./components/PublicHeader";
import PartnerReferralNotice from "./components/PartnerReferralNotice";
import SiteFooter from "./components/SiteFooter";
import DesiredRoleGate from "./components/DesiredRoleGate";
import "./App.css";
import "./AppLayout.css";
import { ToastProvider } from "./components/ToastCenter";
import { PartnerReferralProvider } from "./lib/usePartnerReferral";
import { PassProvider } from "./lib/usePass";

import AnalyticsTracker from "./components/AnalyticsTracker";
import MetaPixelTracker from "./components/MetaPixelTracker";
import ConsentBanner from "./components/ConsentBanner";

const AuthPage = lazy(() => import("./AuthPage"));
const HomePage = lazy(() => import("./HomePage"));
const AlertsPage = lazy(() => import("./AlertsPage"));
const ThanksPage = lazy(() => import("./ThanksPage"));
const PrivacyPage = lazy(() => import("./PrivacyPage"));
const TermsPage = lazy(() => import("./TermsPage"));
const ContactPage = lazy(() => import("./ContactPage"));
const LegalPage = lazy(() => import("./LegalPage"));
const RefundPolicyPage = lazy(() => import("./RefundPolicyPage"));
const LandingPage = lazy(() => import("./LandingPage"));
const PublicOffersPreviewPage = lazy(() => import("./PublicOffersPreviewPage"));
const CvAtsLandingPage = lazy(() => import("./CvAtsLandingPage"));
const CvAtsThankYouPage = lazy(() => import("./CvAtsThankYouPage"));
const ResetPasswordPage = lazy(() => import("./ResetPasswordPage"));
const ProfilePage = lazy(() => import("./ProfilePage"));
const ApplicationsPage = lazy(() => import("./ApplicationsPage"));
const JobRadarFeedPage = lazy(() => import("./JobRadarFeedPage"));
const JobDetailsPage = lazy(() => import("./JobDetailsPage"));
const NotificationsPage = lazy(() => import("./NotificationsPage"));
const JobRadarDigestsPage = lazy(() => import("./JobRadarDigestsPage"));
const JobRadarDigestDetailPage = lazy(() => import("./JobRadarDigestDetailPage"));
const MyCvPage = lazy(() => import("./MyCvPage"));
const SubscriptionPage = lazy(() => import("./SubscriptionPage"));
const PricingPage = lazy(() => import("./PricingPage"));
const AdminHealthPage = lazy(() => import("./AdminHealthPage"));
const AdminSourcesPage = lazy(() => import("./AdminSourcesPage"));
const AdminPartnersPage = lazy(() => import("./AdminPartnersPage"));
const AdminCapcarriereDraftPage = lazy(() => import("./AdminCapcarriereDraftPage"));
const PartnerPortalPage = lazy(() => import("./PartnerPortalPage"));
const JobRadarOnboardingPage = lazy(() => import("./JobRadarOnboardingPage"));
const BecomePartnerPage = lazy(() => import("./BecomePartnerPage"));

type AuthLocationState = {
  from?: string;
};

const REDIRECT_STORAGE_KEY = "go4job_auth_redirect_to";

function RouteLoader() {
  return (
    <div style={{ minHeight: "40vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ opacity: 0.75, fontWeight: 700 }}>Chargement…</div>
    </div>
  );
}

function LazyRoute({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteLoader />}>{children}</Suspense>;
}

function isSafeInternalPath(path: unknown): path is string {
  if (typeof path !== "string") return false;

  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;
  if (path.includes("://")) return false;
  if (path.includes("..")) return false;
  if (path.startsWith("/auth")) return false;
  if (path.startsWith("/reset-password")) return false;

  return true;
}

function readStoredRedirect() {
  try {
    const value = localStorage.getItem(REDIRECT_STORAGE_KEY);
    return isSafeInternalPath(value) ? value : null;
  } catch {
    return null;
  }
}

function clearStoredRedirect() {
  try {
    localStorage.removeItem(REDIRECT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function AuthRedirect({ to }: { to: string }) {
  const navigate = useNavigate();

  useEffect(() => {
    clearStoredRedirect();
    navigate(to, { replace: true });
  }, [navigate, to]);

  return <RouteLoader />;
}

function AuthGate() {
  const { session, loading } = useSession();
  const location = useLocation();

  if (loading) {
    return <RouteLoader />;
  }

  if (session) {
    const st = (location.state ?? {}) as AuthLocationState;
    const redirectTo = isSafeInternalPath(st.from) ? st.from : readStoredRedirect() ?? "/jobradar/onboarding";
    return <AuthRedirect to={redirectTo} />;
  }

  return (
    <LazyRoute>
      <AuthPage />
    </LazyRoute>
  );
}

function PublicLayout() {
  const location = useLocation();
  const hideHeader = location.pathname === "/auth" || location.pathname === "/reset-password";

  return (
    <div className="app-shell">
      {!hideHeader && (
        <header className="app-header">
          <div className="app-container">
            <PublicHeader />
          </div>
        </header>
      )}
      <div className="app-container">
        <main className="app-main">
          <PartnerReferralNotice compact />
          <Outlet />
        </main>
      </div>
      <SiteFooter variant="public" />
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <PassProvider>
        <BrowserRouter>
          <PartnerReferralProvider>
            <AnalyticsTracker />
            <MetaPixelTracker />
            <ConsentBanner />
            <Routes>
              <Route element={<PublicLayout />}>
                <Route path="/auth" element={<AuthGate />} />
                <Route
                  path="/reset-password"
                  element={
                    <LazyRoute>
                      <ResetPasswordPage />
                    </LazyRoute>
                  }
                />
                <Route
                  path="/thanks"
                  element={
                    <LazyRoute>
                      <ThanksPage />
                    </LazyRoute>
                  }
                />
                <Route
                  path="/privacy"
                  element={
                    <LazyRoute>
                      <PrivacyPage />
                    </LazyRoute>
                  }
                />
                <Route
                  path="/terms"
                  element={
                    <LazyRoute>
                      <TermsPage />
                    </LazyRoute>
                  }
                />
                <Route
                  path="/legal"
                  element={
                    <LazyRoute>
                      <LegalPage />
                    </LazyRoute>
                  }
                />
                <Route
                  path="/refund-policy"
                  element={
                    <LazyRoute>
                      <RefundPolicyPage />
                    </LazyRoute>
                  }
                />
                <Route
                  path="/contact"
                  element={
                    <LazyRoute>
                      <ContactPage />
                    </LazyRoute>
                  }
                />
                <Route
                  path="/devenir-partenaire"
                  element={
                    <LazyRoute>
                      <BecomePartnerPage />
                    </LazyRoute>
                  }
                />
                <Route
                  path="/pricing"
                  element={
                    <LazyRoute>
                      <PricingPage />
                    </LazyRoute>
                  }
                />
                <Route
                  path="/landing"
                  element={
                    <LazyRoute>
                      <LandingPage />
                    </LazyRoute>
                  }
                />
                <Route
                  path="/offres"
                  element={
                    <LazyRoute>
                      <PublicOffersPreviewPage />
                    </LazyRoute>
                  }
                />
              </Route>

              <Route
                path="/cv-ats"
                element={
                  <LazyRoute>
                    <CvAtsLandingPage />
                  </LazyRoute>
                }
              />
              <Route
                path="/cv-ats/merci"
                element={
                  <LazyRoute>
                    <CvAtsThankYouPage />
                  </LazyRoute>
                }
              />

              <Route path="/capcarriere/applications" element={<Navigate to="/jobradar/feed" replace />} />
              <Route path="/capcarriere/applications/:draftId" element={<Navigate to="/jobradar/feed" replace />} />

              <Route
                element={
                  <ProtectedRoute>
                    <DesiredRoleGate>
                      <AppLayout />
                    </DesiredRoleGate>
                  </ProtectedRoute>
                }
              >
                <Route
                  path="/"
                  element={
                    <JobRadarOnboardingGate when="home">
                      <LazyRoute>
                        <HomePage />
                      </LazyRoute>
                    </JobRadarOnboardingGate>
                  }
                />
                <Route
                  path="/jobradar/onboarding"
                  element={
                    <LazyRoute>
                      <JobRadarOnboardingPage />
                    </LazyRoute>
                  }
                />
                <Route
                  path="/profile"
                  element={
                    <LazyRoute>
                      <ProfilePage />
                    </LazyRoute>
                  }
                />
                <Route
                  path="/applications"
                  element={
                    <JobRadarOnboardingGate>
                      <LazyRoute>
                        <ApplicationsPage />
                      </LazyRoute>
                    </JobRadarOnboardingGate>
                  }
                />
                <Route
                  path="/alerts"
                  element={
                    <LazyRoute>
                      <AlertsPage />
                    </LazyRoute>
                  }
                />
                <Route
                  path="/admin/health"
                  element={
                    <AdminRoute>
                      <LazyRoute>
                        <AdminHealthPage />
                      </LazyRoute>
                    </AdminRoute>
                  }
                />
                <Route
                  path="/admin/partners"
                  element={
                    <AdminRoute>
                      <LazyRoute>
                        <AdminPartnersPage />
                      </LazyRoute>
                    </AdminRoute>
                  }
                />
                <Route
                  path="/admin/sources"
                  element={
                    <AdminRoute>
                      <LazyRoute>
                        <AdminSourcesPage />
                      </LazyRoute>
                    </AdminRoute>
                  }
                />
                <Route
                  path="/admin/capcarriere/drafts/:draftId"
                  element={
                    <AdminRoute>
                      <LazyRoute>
                        <AdminCapcarriereDraftPage />
                      </LazyRoute>
                    </AdminRoute>
                  }
                />
                <Route
                  path="/me/cv"
                  element={
                    <LazyRoute>
                      <MyCvPage />
                    </LazyRoute>
                  }
                />
                <Route
                  path="/me/subscription"
                  element={
                    <LazyRoute>
                      <SubscriptionPage />
                    </LazyRoute>
                  }
                />
                <Route
                  path="/me/partner"
                  element={
                    <LazyRoute>
                      <PartnerPortalPage />
                    </LazyRoute>
                  }
                />
                <Route path="/jobradar" element={<Navigate to="/jobradar/feed" replace />} />
                <Route path="/jobradar/profile" element={<Navigate to="/profile" replace />} />
                <Route
                  path="/jobradar/alerts"
                  element={
                    <LazyRoute>
                      <AlertsPage />
                    </LazyRoute>
                  }
                />
                <Route
                  path="/jobradar/applications"
                  element={
                    <JobRadarOnboardingGate>
                      <LazyRoute>
                        <ApplicationsPage />
                      </LazyRoute>
                    </JobRadarOnboardingGate>
                  }
                />
                <Route
                  path="/jobradar/notifications"
                  element={
                    <LazyRoute>
                      <NotificationsPage />
                    </LazyRoute>
                  }
                />
                <Route
                  path="/jobradar/digests"
                  element={
                    <LazyRoute>
                      <JobRadarDigestsPage />
                    </LazyRoute>
                  }
                />
                <Route
                  path="/jobradar/digests/:runId"
                  element={
                    <LazyRoute>
                      <JobRadarDigestDetailPage />
                    </LazyRoute>
                  }
                />
                <Route
                  path="/jobradar/feed"
                  element={
                    <LazyRoute>
                      <JobRadarFeedPage />
                    </LazyRoute>
                  }
                />
                <Route
                  path="/jobradar/jobs/:id"
                  element={
                    <JobRadarOnboardingGate>
                      <LazyRoute>
                        <JobDetailsPage />
                      </LazyRoute>
                    </JobRadarOnboardingGate>
                  }
                />
              </Route>

              <Route path="*" element={<Navigate to="/landing" replace />} />
            </Routes>
          </PartnerReferralProvider>
        </BrowserRouter>
      </PassProvider>
    </ToastProvider>
  );
}
