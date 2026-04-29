import { useEffect } from "react";
import "./App.css";

export default function RefundPolicyPage() {
  useEffect(() => {
    document.title = "Politique de remboursement et d'annulation - Go4Job";
  }, []);

  return (
    <div className="app-narrow">
      <h1>Politique de remboursement et d'annulation</h1>
      <p>Dernière mise à jour : avril 2026</p>

      <h2>1. Pass JobRadar</h2>
      <p>
        Les pass JobRadar sont des paiements uniques. Il n'y a pas de renouvellement automatique
        actuellement. Une fois le pass activé, vous accédez au service pendant la durée choisie.
      </p>
      <p>Les durées actuelles sont 7 jours, 30 jours et 90 jours.</p>

      <h2>2. Cas de remboursement possibles</h2>
      <p>Une demande de remboursement peut être étudiée dans les cas suivants :</p>
      <ul>
        <li>double paiement ;</li>
        <li>paiement prélevé mais pass non activé ;</li>
        <li>
          problème technique majeur empêchant l'accès au service et non corrigé dans un délai
          raisonnable.
        </li>
      </ul>
      <p>Les demandes sont étudiées au cas par cas.</p>

      <h2>3. Limites</h2>
      <p>
        Aucun remboursement n'est garanti simplement parce que vous n'avez pas obtenu d'emploi,
        d'entretien ou de réponse positive. JobRadar aide à organiser et améliorer votre recherche,
        mais ne garantit pas les résultats de recherche d'emploi.
      </p>

      <h2>4. Demander un remboursement</h2>
      <p>
        Pour demander un remboursement, écrivez à{" "}
        <a href="mailto:contact@go4jobapp.com">contact@go4jobapp.com</a> avec :
      </p>
      <ul>
        <li>l'email du compte ;</li>
        <li>la date du paiement ;</li>
        <li>le plan acheté ;</li>
        <li>la preuve ou référence de paiement ;</li>
        <li>la description du problème.</li>
      </ul>
      <p>Le délai de réponse indicatif est de 5 à 10 jours ouvrés.</p>

      <h2>5. Prestataires de paiement futurs</h2>
      <p>
        Si un prestataire de paiement international comme 2Checkout/Verifone est activé à l'avenir,
        certains remboursements pourront aussi être soumis aux règles du prestataire de paiement
        concerné.
      </p>
    </div>
  );
}
