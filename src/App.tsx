import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";

import ProtectedRoute from "./lib/ProtectedRoute";
import { useSession } from "./lib/useSession";

import AppLayout from "./AppLayout";
import "./App.css";
import { ToastProvider } from "./components/ToastCenter";

import AuthPage from "./AuthPage";
import HomePage from "./HomePage";
import ProfilePage from "./ProfilePage";
import ApplicationsPage from "./ApplicationsPage";
import AlertsPage from "./AlertsPage";

import JobRadarFeedPage from "./JobRadarFeedPage";
import JobDetailsPage from "./JobDetailsPage";

import MyCvPage from "./MyCvPage";
import ThanksPage from "./ThanksPage";
import PrivacyPage from "./PrivacyPage";
import TermsPage from "./TermsPage";
import ContactPage from "./ContactPage";

// ✅ Admin
import AdminSourcesPage from "./AdminSourcesPage";

// ✅ Reset password page (nouveau)
import ResetPasswordPage from "./ResetPasswordPage";

type AuthLocationState = {
  from?: string;
};

function isSafeInternalPath(path: unknown): path is string {
  if (typeof path !== "string") return false;

  // doit être un chemin interne absolu
  if (!path.startsWith("/")) return false;

  // empêche les URLs externes / schémas
  if (path.startsWith("//")) return false;
  if (path.includes("://")) return false;

  // empêche les path tricks
  if (path.includes("..")) return false;

  // empêche boucle auth/reset
  if (path.startsWith("/auth")) return false;
  if (path.startsWith("/reset-password")) return false;

  return true;
}

function AuthGate() {
  const { session, loading } = useSession();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ opacity: 0.75, fontWeight: 700 }}>Chargement…</div>
      </div>
    );
  }

  // ✅ Si déjà connecté: aller vers "from" si présent, sinon feed
  if (session) {
    const st = (location.state ?? {}) as AuthLocationState;
    const redirectTo = isSafeInternalPath(st.from) ? st.from : "/jobradar/feed";
    return <Navigate to={redirectTo} replace />;
  }

  return <AuthPage />;
}

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          {/* Public */}
          <Route path="/auth" element={<AuthGate />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/thanks" element={<ThanksPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/contact" element={<ContactPage />} />

          {/* Protected area with shared layout */}
          <Route
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            {/* Routes principales */}
            <Route path="/" element={<HomePage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/applications" element={<ApplicationsPage />} />
            <Route path="/alerts" element={<AlertsPage />} />

            {/* ✅ Admin */}
            <Route path="/admin/sources" element={<AdminSourcesPage />} />

            {/* CV */}
            <Route path="/me/cv" element={<MyCvPage />} />

            {/* JobRadar */}
            <Route path="/jobradar" element={<Navigate to="/jobradar/feed" replace />} />

            {/* compat: ancien lien */}
            <Route path="/jobradar/profile" element={<Navigate to="/profile" replace />} />

            <Route path="/jobradar/alerts" element={<AlertsPage />} />
            <Route path="/jobradar/applications" element={<ApplicationsPage />} />
            <Route path="/jobradar/feed" element={<JobRadarFeedPage />} />
            <Route path="/jobradar/jobs/:id" element={<JobDetailsPage />} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}
