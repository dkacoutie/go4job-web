import { useEffect } from "react";
import "./LegalPage.css";

export default function TermsPage() {
  useEffect(() => {
    document.title = "Conditions d’utilisation - Go4Job";
  }, []);

  return (
    <div className="legal-wrap">
      <section className="legal-shell">
        <header className="legal-header">
          <div className="legal-kicker">Légal</div>
          <h1 className="legal-title">Conditions d’utilisation</h1>
          <p className="legal-sub">
            Ce document explique les règles d’usage de Go4Job.
          </p>
        </header>

        <h2>1. Acceptation des conditions</h2>
        <p>
          En utilisant Go4Job, vous acceptez d’être lié par ces conditions d’utilisation.
          Si vous n’acceptez pas ces conditions, veuillez ne pas utiliser notre service.
        </p>

        <h2>2. Description du service</h2>
        <p>Go4Job est une plateforme de recherche d’emploi alimentée par l’intelligence artificielle qui :</p>
        <ul>
          <li>Recherche automatiquement des offres d’emploi sur multiple plateformes</li>
          <li>Génère des CV et lettres de motivation personnalisés</li>
          <li>Envoie des candidatures automatiques avec votre consentement</li>
          <li>Fournit des outils d’analyse et de suivi de candidatures</li>
        </ul>

        <h2>3. Compte utilisateur</h2>
        <p>
          Vous êtes responsable de maintenir la confidentialité de vos identifiants de connexion
          et de toutes les activités qui se produisent sous votre compte.
        </p>

        <h2>4. Candidatures automatiques</h2>
        <p>En activant les candidatures automatiques, vous :</p>
        <ul>
          <li>Autorisez Go4Job à postuler en votre nom aux offres correspondant à vos critères</li>
          <li>Confirmez que les informations fournies sont exactes et à jour</li>
          <li>Acceptez la responsabilité du contenu des candidatures envoyées</li>
          <li>Pouvez désactiver cette fonctionnalité à tout moment</li>
        </ul>

        <h2>5. Propriété intellectuelle</h2>
        <p>
          Vous conservez tous les droits sur vos données personnelles et documents.
          Go4Job détient les droits sur la plateforme, l’algorithme et les technologies utilisées.
        </p>

        <h2>6. Limitation de responsabilité</h2>
        <p>
          Go4Job ne peut être tenu responsable des résultats de votre recherche d’emploi.
          Nous fournissons un outil d’aide à la recherche, mais ne garantissons pas l’obtention d’un emploi.
        </p>

        <h2>7. Résiliation</h2>
        <p>
          Vous pouvez résilier votre compte à tout moment.
          Go4Job se réserve le droit de suspendre ou résilier des comptes en cas de violation de ces conditions.
        </p>

        <h2>8. Modifications</h2>
        <p>
          Nous nous réservons le droit de modifier ces conditions à tout moment.
          Les utilisateurs seront notifiés des changements importants.
        </p>

        <h2>9. Contact</h2>
        <p>
          Pour toute question concernant ces conditions, contactez-nous à{" "}
          <a href="mailto:legal@go4job.org">legal@go4job.org</a>,{" "}
          <a href="mailto:contact@go4job.org">contact@go4job.org</a> ou par téléphone au{" "}
          <a href="tel:+2250151676767">+225 01 51 67 67 67</a>.
        </p>
      </section>
    </div>
  );
}
