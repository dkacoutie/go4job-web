import { useEffect } from "react";
import "./App.css";

export default function TermsPage() {
  useEffect(() => {
    document.title = "Conditions d'utilisation et de vente - Go4Job";
  }, []);

  return (
    <div className="app-narrow">
      <h1>Conditions d'utilisation et de vente</h1>
      <p>Dernière mise à jour : avril 2026</p>

      <h2>1. Acceptation des conditions</h2>
      <p>
        En utilisant Go4Job / JobRadar, vous acceptez les présentes conditions d'utilisation et de
        vente. Si vous n'êtes pas d'accord avec ces conditions, vous ne devez pas utiliser le
        service.
      </p>

      <h2>2. Description du service JobRadar</h2>
      <p>
        JobRadar est un service en ligne côté candidat qui vous aide à découvrir, filtrer,
        sauvegarder et suivre des offres d'emploi pertinentes selon votre profil et vos critères de
        recherche.
      </p>
      <p>
        JobRadar peut vous aider à mieux organiser ou préparer votre recherche d'emploi, mais vous
        restez responsable de vos candidatures, de vos documents, des informations que vous
        fournissez et de vos échanges avec les recruteurs.
      </p>

      <h2>3. Rôle limité de JobRadar</h2>
      <p>
        JobRadar n'est pas une agence de recrutement, ne vend pas d'annonces aux employeurs et ne
        prend aucune décision d'embauche. Le service ne garantit pas l'obtention d'un emploi, d'un
        entretien ou d'une réponse positive d'un recruteur.
      </p>
      <p>
        Aujourd'hui, JobRadar n'envoie pas de candidatures au nom de l'utilisateur. Vous restez seul
        responsable de l'envoi de vos candidatures et de leur contenu.
      </p>

      <h2>4. Compte utilisateur</h2>
      <p>
        Vous êtes responsable de votre compte, de vos identifiants et des informations fournies dans
        le service. Vous devez fournir des informations sincères, exactes et à jour.
      </p>

      <h2>5. Pass payants</h2>
      <p>
        JobRadar propose actuellement des pass payants de 7 jours, 30 jours et 90 jours. Ces pass
        sont des paiements uniques. Aucun renouvellement automatique n'est appliqué actuellement.
      </p>
      <p>
        Le pass est activé après confirmation du paiement réussi. Le paiement actuel est effectué en
        FCFA (XOF) via Paystack. Le site pourra proposer à l'avenir d'autres moyens de paiement,
        devises ou prestataires.
      </p>

      <h2>6. Usages interdits</h2>
      <p>
        Sont interdits : la fraude, l'usage abusif du service, toute tentative d'accès non autorisé,
        l'extraction massive non autorisée de données et toute action visant à perturber le service.
      </p>
      <p>
        Go4Job peut suspendre un compte en cas d'usage abusif ou contraire aux présentes conditions.
      </p>

      <h2>7. Propriété intellectuelle</h2>
      <p>
        Les marques, textes, interfaces, éléments graphiques, contenus, fonctionnalités et éléments
        techniques du site sont protégés. Toute reproduction, extraction ou utilisation non
        autorisée est interdite.
      </p>
      <p>
        Vous conservez les droits sur les informations, documents et contenus personnels que vous
        fournissez dans le service.
      </p>

      <h2>8. Responsabilité</h2>
      <p>
        Go4Job fournit un outil d'aide à la recherche d'emploi. Le service peut évoluer, être
        modifié ou interrompu pour maintenance. Go4Job ne peut pas être tenu responsable des
        décisions des recruteurs, des réponses reçues ou non reçues, ni du résultat final de votre
        recherche d'emploi.
      </p>

      <h2>9. Modification du service ou des conditions</h2>
      <p>
        Go4Job peut modifier le service ou les présentes conditions pour les adapter à l'évolution du
        produit, de la loi ou des moyens de paiement. Les changements importants pourront être
        signalés dans le service ou par email.
      </p>

      <h2>10. Contact</h2>
      <p>
        Pour toute question concernant ces conditions, vous pouvez écrire à{" "}
        <a href="mailto:contact@go4jobapp.com">contact@go4jobapp.com</a>.
      </p>
    </div>
  );
}
