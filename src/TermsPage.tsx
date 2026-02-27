import { useEffect } from "react";
import "./App.css";

export default function TermsPage() {
  useEffect(() => {
    document.title = "Conditions d'utilisation - Go4Job";
  }, []);

  return (
    <div className="app-narrow">
      <h1>Conditions d'utilisation</h1>

      <h2>1. Acceptation des conditions</h2>
      <p>
        En utilisant Go4Job, vous acceptez d'être lié par ces conditions d'utilisation. Si vous
        n'acceptez pas ces conditions, veuillez ne pas utiliser notre service.
      </p>

      <h2>2. Description du service</h2>
      <p>Go4Job est une plateforme de recherche d'emploi assistée par l'IA qui :</p>
      <ul>
        <li>Recherche automatiquement des offres d'emploi sur plusieurs plateformes</li>
        <li>Génère des CV et lettres de motivation personnalisés</li>
        <li>Permet de préparer et suivre vos candidatures</li>
        <li>Fournit des outils d'analyse et de suivi</li>
      </ul>

      <h2>3. Compte utilisateur</h2>
      <p>
        Vous êtes responsable de la confidentialité de vos identifiants de connexion et de toutes
        les activités qui se produisent sous votre compte.
      </p>

      <h2>4. Candidatures</h2>
      <p>
        Le service vous aide à organiser vos candidatures. L'envoi effectif et le contenu final
        restent de votre responsabilité.
      </p>

      <h2>5. Propriété intellectuelle</h2>
      <p>
        Vous conservez tous les droits sur vos données personnelles et documents. Go4Job détient
        les droits sur la plateforme, l'algorithme et les technologies utilisées.
      </p>

      <h2>6. Limitation de responsabilité</h2>
      <p>
        Go4Job ne peut être tenu responsable des résultats de votre recherche d'emploi. Nous
        fournissons un outil d'aide à la recherche, mais ne garantissons pas l'obtention d'un
        emploi.
      </p>

      <h2>7. Résiliation</h2>
      <p>
        Vous pouvez résilier votre compte à tout moment. Go4Job se réserve le droit de suspendre ou
        résilier des comptes en cas de violation de ces conditions.
      </p>

      <h2>8. Modifications</h2>
      <p>
        Nous nous réservons le droit de modifier ces conditions à tout moment. Les utilisateurs
        seront notifiés des changements importants.
      </p>

      <h2>9. Contact</h2>
      <p>
        Pour toute question concernant ces conditions, contactez-nous à{" "}
        <a href="mailto:legal@go4jobapp.com">legal@go4jobapp.com</a> ou{" "}
        <a href="mailto:contact@go4jobapp.com">contact@go4jobapp.com</a>.
      </p>
    </div>
  );
}
