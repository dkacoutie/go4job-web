import { useEffect } from "react";
import "./App.css";

export default function LegalPage() {
  useEffect(() => {
    document.title = "Mentions légales - Go4Job";
  }, []);

  return (
    <div className="app-narrow">
      <h1>Mentions légales</h1>
      <p>Dernière mise à jour : avril 2026</p>

      <h2>Éditeur du site</h2>
      <p>
        GLOBAL DREAMS & CO, SARL au capital social de 1 000 000 FCFA,
        immatriculée en Côte d'Ivoire.
      </p>

      <h2>Identifiants</h2>
      <p>
        IDU : CI-2018-0002453 D
        <br />
        RCCM : CI-ABJ-2018-B-04830
      </p>

      <h2>Siège / adresse publique</h2>
      <p>Abidjan, Côte d'Ivoire</p>

      <h2>Responsable de publication</h2>
      <p>KACOUTIE AFFALY DIEUDONNE</p>

      <h2>Contact</h2>
      <p>
        <a href="mailto:contact@go4jobapp.com">contact@go4jobapp.com</a>
      </p>

      <h2>Produit exploité</h2>
      <p>Go4Job / JobRadar</p>

      <h2>Hébergement frontend</h2>
      <p>Netlify</p>

      <h2>Backend et base de données</h2>
      <p>Supabase</p>

      <h2>Propriété intellectuelle</h2>
      <p>
        Les marques, textes, interfaces, éléments graphiques, contenus, fonctionnalités et éléments
        techniques du site sont protégés. Toute reproduction, extraction ou utilisation non
        autorisée est interdite.
      </p>

      <h2>Support</h2>
      <p>
        Pour toute question, l'utilisateur peut contacter{" "}
        <a href="mailto:contact@go4jobapp.com">contact@go4jobapp.com</a>.
      </p>
    </div>
  );
}
