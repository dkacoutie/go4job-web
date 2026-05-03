import { useEffect } from "react";
import "./App.css";

export default function PrivacyPage() {
  useEffect(() => {
    document.title = "Politique de confidentialité - Go4Job";
  }, []);

  return (
    <div className="app-narrow">
      <h1>Politique de confidentialité</h1>
      <p>Dernière mise à jour : avril 2026</p>

      <h2>1. Données collectées</h2>
      <p>JobRadar peut collecter les données nécessaires au fonctionnement du service :</p>
      <ul>
        <li>données de compte et email ;</li>
        <li>préférences de recherche, poste recherché, localisation ou pays souhaités ;</li>
        <li>niveau d'expérience ;</li>
        <li>CV ou informations professionnelles si vous les fournissez ;</li>
        <li>offres sauvegardées et actions réalisées dans le service ;</li>
        <li>
          données nécessaires au traitement du paiement, sans stockage complet des informations de
          carte bancaire par JobRadar.
        </li>
      </ul>

      <h2>2. Finalités d'utilisation</h2>
      <p>Ces données sont utilisées pour :</p>
      <ul>
        <li>fournir le service JobRadar ;</li>
        <li>personnaliser les offres affichées ;</li>
        <li>gérer votre compte ;</li>
        <li>activer les pass après paiement ;</li>
        <li>assurer le support ;</li>
        <li>sécuriser le service ;</li>
        <li>améliorer l'expérience utilisateur.</li>
      </ul>

      <h2>3. Prestataires techniques</h2>
      <p>
        Go4Job s'appuie sur des prestataires nécessaires au fonctionnement du service, notamment
        Netlify pour l'hébergement frontend, Supabase pour le backend et la base de données,
        Paystack pour le paiement actuel, ainsi que des prestataires email ou support si nécessaire.
      </p>

      <h2>4. Partage des données</h2>
      <p>
        JobRadar ne vend pas vos données personnelles. Le partage est limité aux prestataires
        nécessaires au fonctionnement du service ou aux situations où la loi l'exige.
      </p>

      <h2>5. Sécurité</h2>
      <p>
        Go4Job met en place des mesures raisonnables de sécurité technique et organisationnelle pour
        protéger les données, limiter les accès aux informations nécessaires et sécuriser les
        communications lorsque cela est applicable.
      </p>

      <h2>6. Cookies et mesure d'audience</h2>
      <p>
        Le site peut utiliser des cookies nécessaires au fonctionnement du service, notamment pour la
        session, la sécurité et les préférences. JobRadar peut aussi utiliser des outils de mesure ou
        de suivi publicitaire, comme Meta Pixel, afin de comprendre l'efficacité de ses campagnes et
        d'améliorer ses pages publiques.
      </p>
      <p>
        Ces outils peuvent traiter des informations techniques limitées, comme les pages consultées,
        le navigateur, l'appareil ou des événements de conversion. JobRadar ne promet pas encore de
        centre de préférences cookies dans l'interface ; les réglages disponibles dépendent donc aussi
        de votre navigateur et des plateformes tierces concernées.
      </p>

      <h2>7. Droits utilisateurs</h2>
      <p>
        Vous pouvez demander l'accès à vos données, leur correction, leur suppression, ou demander
        une opposition ou une limitation lorsque cela est applicable. Pour exercer vos droits,
        écrivez à <a href="mailto:contact@go4jobapp.com">contact@go4jobapp.com</a>.
      </p>

      <h2>8. Conservation</h2>
      <p>
        Les données sont conservées pendant la durée nécessaire au service. Certaines données peuvent
        être conservées plus longtemps pour des obligations légales, la sécurité, la preuve ou la
        gestion des paiements.
      </p>

      <h2>9. Contact</h2>
      <p>
        Pour toute question sur cette politique ou sur vos données personnelles, contactez{" "}
        <a href="mailto:contact@go4jobapp.com">contact@go4jobapp.com</a>.
      </p>
    </div>
  );
}
