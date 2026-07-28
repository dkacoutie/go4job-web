import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useSession } from "./useSession";

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  const location = useLocation();

  if (loading) return null; // ou un petit "Chargement..."

  if (!session) {
    // Un visiteur qui arrive sur la racine du site decouvre JobRadar : il faut
    // lui montrer ce que le produit fait avant de lui demander un compte.
    // Jusqu'ici la racine etant protegee, il atterrissait directement sur le
    // formulaire de connexion, sans une ligne expliquant l'interet du service,
    // pendant que la page vitrine existante (/landing) restait inaccessible.
    //
    // Sur toutes les autres routes protegees, la demande est explicite : le
    // visiteur voulait une page precise, on l'envoie se connecter et on
    // conserve sa destination.
    const target = location.pathname === "/" ? "/landing" : "/auth";
    return <Navigate to={target} replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
