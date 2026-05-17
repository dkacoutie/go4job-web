import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import { useSession } from "./useSession";

export default function AdminRoute({ children }: { children: ReactNode }) {
  const { session, loading: sessionLoading } = useSession();
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminLoading, setAdminLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (sessionLoading) {
        return;
      }

      if (!session?.user?.id) {
        if (!cancelled) {
          setIsAdmin(false);
          setAdminLoading(false);
        }
        return;
      }

      if (!cancelled) {
        setAdminLoading(true);
      }

      const { data, error } = await supabase.rpc("is_admin_user");

      if (cancelled) return;

      if (error) {
        console.warn("[AdminRoute] admin check failed", {
          code: error.code,
          message: error.message,
        });
      }

      setIsAdmin(!error && data === true);
      setAdminLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, sessionLoading]);

  if (sessionLoading || adminLoading) {
    return (
      <div style={{ minHeight: "40vh", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ opacity: 0.75, fontWeight: 700 }}>Verification des droits admin...</div>
      </div>
    );
  }

  if (!session || !isAdmin) {
    return (
      <div style={{ padding: "24px 0" }}>
        <section
          style={{
            maxWidth: 720,
            margin: "0 auto",
            padding: 24,
            borderRadius: 20,
            border: "1px solid rgba(15, 23, 42, 0.08)",
            background: "#fff",
            boxShadow: "0 16px 40px rgba(15, 23, 42, 0.08)",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "6px 10px",
              borderRadius: 999,
              background: "#fee2e2",
              color: "#991b1b",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            Acces refuse
          </div>
          <h1 style={{ marginTop: 16, marginBottom: 12 }}>Admin réservé à l'équipe autorisée</h1>
          <p style={{ margin: 0, color: "#475569", lineHeight: 1.6 }}>
            Cette page utilise maintenant l'autorisation admin centralisee. Si tu penses devoir y acceder, demande
            l'activation de ton compte admin.
          </p>
          <div style={{ marginTop: 20 }}>
            <Link
              to="/"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "10px 14px",
                borderRadius: 12,
                background: "#0f172a",
                color: "#fff",
                textDecoration: "none",
                fontWeight: 700,
              }}
            >
              Retour au dashboard
            </Link>
          </div>
        </section>
      </div>
    );
  }

  return <>{children}</>;
}
