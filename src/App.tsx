import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import ProtectedRoute from "./lib/ProtectedRoute";

import AppLayout from "./AppLayout";
import "./App.css";

import AuthPage from "./AuthPage";
import HomePage from "./HomePage";
import ProfilePage from "./ProfilePage";
import ApplicationsPage from "./ApplicationsPage";
import AlertsPage from "./AlertsPage";

import JobRadarFeedPage from "./JobRadarFeedPage";
import JobDetailsPage from "./JobDetailsPage";

import MyCvPage from "./MyCvPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/auth" element={<AuthPage />} />

        {/* Protected area with shared layout */}
        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<HomePage />} />

          {/* “classiques” */}
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/applications" element={<ApplicationsPage />} />
          <Route path="/alerts" element={<AlertsPage />} />

          {/* CV */}
          <Route path="/me/cv" element={<MyCvPage />} />

          {/* JobRadar */}
          <Route path="/jobradar" element={<Navigate to="/jobradar/feed" replace />} />
          <Route path="/jobradar/profile" element={<ProfilePage />} />
          <Route path="/jobradar/alerts" element={<AlertsPage />} />
          <Route path="/jobradar/applications" element={<ApplicationsPage />} />
          <Route path="/jobradar/feed" element={<JobRadarFeedPage />} />
          <Route path="/jobradar/jobs/:id" element={<JobDetailsPage />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
