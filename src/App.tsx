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

import AuthPage from "./AuthPage";
import HomePage from "./HomePage";
import AlertsPage from "./AlertsPage";
import ThanksPage from "./ThanksPage";
import PrivacyPage from "./PrivacyPage";
import TermsPage from "./TermsPage";
import ContactPage from "./ContactPage";
import LegalPage from "./LegalPage";
import RefundPolicyPage from "./RefundPolicyPage";
import LandingPage from "./LandingPage";
import LandingAnalyticsTracker from "./components/LandingAnalyticsTracker";
import MetaPixelTracker from "./components/MetaPixelTracker";
import ResetPasswordPage from "./ResetPasswordPage";

const ProfilePage = lazy(() => import("./ProfilePage"));
const ApplicationsPage = lazy(() => import("./ApplicationsPage"));
const JobRadarFeedPage = lazy(() => import("./JobRadarFeedPage"));
const JobDetailsPage = lazy(() => import("./JobDetailsPage"));
const MyCvPage = lazy(() => import("./MyCvPage"));
const SubscriptionPage = lazy(() => import("./SubscriptionPage"));
const PricingPage = lazy(() => import("./PricingPage"));
const AdminHealthPage = lazy(() => import("./AdminHealthPage"));
const AdminSourcesPage = lazy(() => import("./AdminSourcesPage"));
const AdminPartnersPage = lazy(() => import("./AdminPartnersPage"));
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

  return <AuthPage />;
}

function PublicLayout() {
  const location = useLocation();
  const hideHeader = location.pathname === "/auth" || location.pathname === "/reset-password";
  const hideFooter = location.pathname === "/landing";

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
      {!hideFooter && <SiteFooter variant="public" />}
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <PassProvider>
        <BrowserRouter>
          <PartnerReferralProvider>
            <LandingAnalyticsTracker />
            <MetaPixelTracker />
            <Routes>
              <Route element={<PublicLayout />}>
                <Route path="/auth" element={<AuthGate />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/thanks" element={<ThanksPage />} />
                <Route path="/privacy" element={<PrivacyPage />} />
                <Route path="/terms" element={<TermsPage />} />
                <Route path="/legal" element={<LegalPage />} />
                <Route path="/refund-policy" element={<RefundPolicyPage />} />
                <Route path="/contact" element={<ContactPage />} />
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
                <Route path="/landing" element={<LandingPage />} />
              </Route>

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
                      <HomePage />
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
                <Route path="/alerts" element={<AlertsPage />} />
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
                <Route path="/jobradar/alerts" element={<AlertsPage />} />
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
