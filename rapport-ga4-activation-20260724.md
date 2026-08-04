# GA4 — activation et instrumentation du funnel JobRadar

Date : 24/07/2026
Branche : dev
Commits : `7437c4a` (activation + instrumentation), `ee08455` (correctif faux-positif PII + troncature URL)
Domaine mesuré : `jobradar.go4jobapp.com` (production réelle, redirigée depuis `go4jobapp.com`)
Propriété GA4 : `G-EET5B96SX7`

## Constat de départ

`initGoogleAnalytics()` existait dans le code mais n'était appelée nulle part. Aucune donnée n'a jamais été collectée avant cette intervention, malgré la présence de l'identifiant depuis un certain temps.

## Fichiers modifiés

- `src/lib/analytics.ts` — réécrit. Init unique gardée par domaine de production réel et build prod, `send_page_view: false` pour éviter le double comptage du gtag automatique, allowlist stricte de paramètres, filtre anti-PII, dédup persistante pour `purchase`.
- `src/components/AnalyticsTracker.tsx` — renommé depuis `LandingAnalyticsTracker.tsx` (qui ne couvrait que `/landing`). Appelle l'init et `trackPageView` à chaque changement de route.
- `src/App.tsx` — branche `AnalyticsTracker` au niveau racine, à côté du tracker Meta Pixel existant.
- `src/AuthPage.tsx` — `sign_up` / `login` (email et Google OAuth, avec détection nouveau vs revenant).
- `src/JobRadarOnboardingPage.tsx` — `tutorial_begin` / `tutorial_complete`.
- `src/JobRadarFeedPage.tsx` — `search`, `select_content`.
- `src/AlertsPage.tsx` — `alert_created`.
- `src/ProfilePage.tsx` — `profile_completed` (uniquement sur la transition incomplet → complet, pas à chaque enregistrement).
- `src/JobDetailsPage.tsx` — `application_started`.
- `src/PricingPage.tsx` — `pricing_viewed`, `begin_checkout`, `purchase`, `payment_failed`.

## Événements ajoutés et paramètres

| Événement | Déclencheur | Paramètres |
|---|---|---|
| `page_view` | chaque changement de route SPA | `page_path`, `page_location`, `page_title` |
| `sign_up` | inscription email confirmée, ou premier login Google (< 15s entre création et connexion) | `method` |
| `login` | connexion email réussie, ou Google reconnu comme utilisateur existant | `method` |
| `tutorial_begin` | entrée dans l'onboarding | — |
| `tutorial_complete` | clic sur « Ouvrir mes offres » en fin d'onboarding | — |
| `search` | recherche exécutée dans le feed (debounce 400ms) | `search_term` (filtré si PII), `country`, `contract_type`, `work_mode`, `results_count` |
| `select_content` | clic sur une offre | `content_type`, `item_id` |
| `alert_created` | alerte créée avec succès | `has_country_filter`, `frequency`, `channel` |
| `profile_completed` | profil passant d'incomplet à complet | — |
| `application_started` | clic sur « Postuler » | `item_id` |
| `pricing_viewed` | affichage de la page tarifs | `page_type` |
| `begin_checkout` | clic sur un plan | `plan_id`, `plan_name`, `value`, `currency` |
| `purchase` | paiement confirmé côté serveur (`paystack_verify`, statut `ok`), lu directement dans `billing_payments` | `transaction_id`, `plan_id`, `plan_name`, `value`, `currency`, `test_mode` |
| `payment_failed` | échec d'initialisation ou de vérification du paiement | `reason`, `plan_id` (si connu) |

## Événements clés à déclarer manuellement dans GA4 (Admin → Événements → Marquer comme événement clé)

`sign_up`, `profile_completed` (ou `tutorial_complete`), `alert_created`, `begin_checkout`, `purchase`. Cette étape ne peut pas être faite depuis le code : elle se fait dans l'interface GA4.

## Protections anti-doublon

- Init gardée par `window.__jrGaInitialized` : un seul appel `gtag('config', ...)` par session de page.
- `send_page_view: false` : le `page_view` automatique de gtag est désactivé, seul le `page_view` manuel envoyé par `AnalyticsTracker` compte.
- `page_view` dédupliqué par clé `pathname+search` (`window.__jrLastGaPageView`) : un changement de route identique consécutif ne renvoie pas l'événement.
- `purchase` déduplique par référence de transaction dans `localStorage`, donc un rechargement de la page de retour de paiement ne renvoie jamais le même achat. L'événement ne part que si `paystack_verify` confirme un paiement réel, jamais depuis la simple présence sur la page de retour.

## Protections contre les données personnelles

- Allowlist stricte des clés de paramètres (`ALLOWED_PARAM_KEYS`) : tout champ hors liste est rejeté avant envoi.
- Détection email (regex) sur tous les champs texte envoyés.
- Détection téléphone en plus de l'email, réservée au seul champ de texte libre (`search_term`) — un terme de recherche contenant un numéro est filtré, un identifiant structuré (UUID, référence de transaction) ne l'est plus (voir bug corrigé ci-dessous).
- Aucun envoi de nom, email, téléphone, contenu de CV/lettre, texte libre de profil.
- Aucune donnée en dehors du domaine de production réel (dev/preview/tests exclus par construction).

### Bug trouvé et corrigé pendant la vérification live (commit `ee08455`)

Le filtre téléphone (basé sur une suite de chiffres/tirets) faisait un faux positif sur les UUID d'offres et les références de transaction Paystack, supprimant à tort `item_id`, `page_path` et `page_location` de vrais événements en production. Corrigé en restreignant le contrôle téléphone au seul champ `search_term`. `page_location` était par ailleurs tronqué à 80 caractères comme n'importe quel champ, cassant l'URL — corrigé avec une limite dédiée de 300 caractères pour ce champ.

Ces deux bugs n'existaient que sur le premier commit (`7437c4a`), déjà corrigés et déployés avant toute campagne.

## Vérification effectuée

- Suite de 12 cas testés hors navigateur (esbuild + Node) : init, dédup page_view, filtre PII, dédup purchase, aucun envoi hors production. Tous verts.
- `tsc --noEmit` : aucune erreur.
- `vite build` complet : aucune erreur, bundle généré.
- **Vérification en direct sur `jobradar.go4jobapp.com` après déploiement**, script `gtag.js` chargé confirmé, `dataLayer` inspecté sur trois routes réelles (`/jobradar/feed`, `/jobradar/jobs/{uuid}`, `/pricing`) :
  - un seul `config` par chargement de page ;
  - un seul `page_view` par route, aucun doublon ;
  - `select_content` envoie bien `item_id` avec l'UUID complet (bug corrigé confirmé) ;
  - `page_view` sur la page offre envoie `page_location` complet, non tronqué (bug corrigé confirmé) ;
  - `pricing_viewed` envoie `page_type` sans aucune donnée personnelle.

### Limite de vérification

Je n'ai pas pu observer directement la requête de collecte GA4 (`google-analytics.com`) dans le trafic réseau du navigateur de test : les outils réseau disponibles ne montrent que des requêtes vers `kaspersky-labs.com` (protection web active sur ce poste), ce qui suggère une interception locale plutôt qu'une absence réelle d'envoi — le `dataLayer` est correctement peuplé et `gtag.js` est chargé, ce qui est cohérent avec un envoi qui a lieu. Je n'ai pas accès au compte Google Analytics : Tag Assistant, Realtime et DebugView (points 5 et 6 de la checklist) doivent être vérifiés côté Dieudonné, dans l'interface GA4.

## Statut Git / déploiement

- Push effectué sur `dev` : `ccb660a..7437c4a`, puis `7437c4a..ee08455`.
- Déploiement automatique confirmé (hash de bundle changé sur le domaine réel après chaque push).

## Actions manuelles restantes (interface Google, hors de ma portée)

1. Ouvrir GA4 → Realtime, naviguer sur le site, confirmer visuellement les événements.
2. Ouvrir DebugView (nécessite l'extension GA Debugger ou `?_dbg=1`) pour un contrôle paramètre par paramètre.
3. Marquer comme événements clés : `sign_up`, `profile_completed` ou `tutorial_complete`, `alert_created`, `begin_checkout`, `purchase`.
4. Vérifier qu'aucun autre filtre interne à la propriété GA4 n'exclut le trafic (IP interne, filtre de test).

## Point de vigilance non traité (hors périmètre de cette mission)

Aucune bannière de consentement cookies n'existe sur le site (constaté lors de l'audit du 24/07). `anonymize_ip: true` est actif mais ne remplace pas un recueil de consentement pour les visiteurs UE. Signalé pour arbitrage, non corrigé ici car hors du périmètre demandé (activer GA4 proprement).
