import { useEffect } from "react";
import "./LegalPage.css";

export default function PrivacyPage() {
  useEffect(() => {
    document.title = "Politique de confidentialité - Go4Job";
  }, []);

  return (
    <div className="legal-wrap">
      <section className="legal-shell">
        <header className="legal-header">
          <div className="legal-kicker">Légal</div>
          <h1 className="legal-title">Politique de confidentialité</h1>
          <p className="legal-sub">
            Comment nous collectons, utilisons et protégeons vos données.
          </p>
        </header>

        <h2>1. Collecte des données</h2>
        <p>Nous collectons les informations que vous nous fournissez directement :</p>
        <ul>
          <li>Informations de compte (nom, email, mot de passe)</li>
          <li>CV et informations professionnelles</li>
          <li>Préférences de recherche d’emploi</li>
          <li>Historique des candidatures</li>
        </ul>

        <h2>2. Utilisation des données</h2>
        <p>Vos données sont utilisées pour :</p>
        <ul>
          <li>Fournir nos services de recherche d’emploi</li>
          <li>Personnaliser les recommandations d’offres</li>
          <li>Générer des CV et lettres de motivation adaptés</li>
          <li>Envoyer des candidatures en votre nom (avec votre consentement)</li>
          <li>Améliorer nos algorithmes et services</li>
        </ul>

        <h2>3. Partage des données</h2>
        <p>Nous ne vendons jamais vos données personnelles. Nous pouvons partager vos informations :</p>
        <ul>
          <li>Avec les employeurs lors de candidatures (CV, lettre de motivation)</li>
          <li>Avec nos prestataires techniques (hébergement sécurisé)</li>
          <li>Si requis par la loi ou pour protéger nos droits</li>
        </ul>

        <h2>4. Sécurité des données</h2>
        <p>Nous mettons en place des mesures de sécurité appropriées :</p>
        <ul>
          <li>Chiffrement SSL/TLS pour toutes les communications</li>
          <li>Stockage sécurisé avec chiffrement au repos</li>
          <li>Accès limité aux données par notre équipe</li>
          <li>Audits de sécurité réguliers</li>
        </ul>

        <h2>5. Vos droits (RGPD)</h2>
        <p>Conformément au RGPD, vous avez le droit de :</p>
        <ul>
          <li>Accéder à vos données personnelles</li>
          <li>Rectifier des informations inexactes</li>
          <li>Supprimer vos données (droit à l’oubli)</li>
          <li>Limiter le traitement de vos données</li>
          <li>Exporter vos données (portabilité)</li>
          <li>Vous opposer au traitement</li>
        </ul>

        <h2>6. Cookies et technologies similaires</h2>
        <p>Nous utilisons des cookies pour :</p>
        <ul>
          <li>Maintenir votre session de connexion</li>
          <li>Mémoriser vos préférences</li>
          <li>Analyser l’utilisation de la plateforme</li>
          <li>Améliorer l’expérience utilisateur</li>
        </ul>

        <h2>7. Conservation des données</h2>
        <p>Nous conservons vos données :</p>
        <ul>
          <li>Tant que votre compte est actif</li>
          <li>3 ans après la fermeture du compte (obligations légales)</li>
          <li>Suppression automatique après cette période</li>
        </ul>

        <h2>8. Transferts internationaux</h2>
        <p>
          Vos données peuvent être traitées dans des pays offrant un niveau de protection adéquat
          selon la Commission européenne.
        </p>

        <h2>9. Modifications</h2>
        <p>
          Nous pouvons modifier cette politique de confidentialité.
          Les changements importants vous seront notifiés par email.
        </p>

        <h2>10. Contact</h2>
        <p>
          Pour exercer vos droits ou pour toute question, contactez notre DPO à{" "}
          <a href="mailto:privacy@go4job.org">privacy@go4job.org</a>. Vous pouvez aussi nous joindre à{" "}
          <a href="mailto:contact@go4job.org">contact@go4job.org</a> ou par téléphone au{" "}
          <a href="tel:+2250151676767">+225 01 51 67 67 67</a>.
        </p>
      </section>
    </div>
  );
}
