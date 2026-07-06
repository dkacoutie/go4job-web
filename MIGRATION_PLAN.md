# Plan de séparation frontend JobRadar / CapCarrière

> Statut : rapport d'analyse uniquement.  
> Périmètre observé : dépôt `go4job-web` au 22 juin 2026.  
> Aucune modification applicative, Supabase, Netlify ou DNS n'est incluse dans ce document.

## 1. Architecture actuelle

### 1.1 Structure du projet

Le dépôt est actuellement un monolithe frontend React 19 + TypeScript, construit par Vite 7 :

- `src/main.tsx` est l'unique entrée navigateur.
- `src/App.tsx` contient l'ensemble du routing public, candidat, administrateur, JobRadar et CapCarrière.
- Les pages sont placées directement dans `src/`, sans dossiers `brands/`, `entries/`, `jobradar/`, `capcarriere/` ou `shared/`.
- `src/components/` contient des composants transverses et plusieurs composants explicitement JobRadar.
- `src/lib/` contient le client Supabase, les hooks, la facturation, le matching, l'onboarding, les API d'administration et les API CapCarrière.
- `supabase/migrations/` et `supabase/functions/` portent le backend partagé.
- `public/` et `src/assets/` mélangent des assets JobRadar, Go4Job et CapCarrière.

Les dossiers cibles mentionnés dans la mission (`brands/`, `entries/`, `shared/`, dossiers produit dédiés) n'existent pas encore.

Le build actuel ne connaît aucune marque :

- `vite.config.ts` ne contient que `react()`.
- `.env.example` ne contient pas `VITE_BRAND`.
- `netlify.toml` produit un unique dossier `dist` et redirige toutes les routes vers le même `index.html`.
- `index.html` impose le favicon, le titre, la description et la couleur JobRadar à toutes les routes, y compris CapCarrière.

### 1.2 Routing actuel

`BrowserRouter` est instancié une seule fois dans `App.tsx`.

Routes JobRadar principales :

- `/landing`
- `/auth`
- `/`
- `/jobradar/onboarding`
- `/jobradar/feed`
- `/jobradar/jobs/:id`
- `/jobradar/alerts`
- `/jobradar/applications`
- `/jobradar/profile` redirige vers `/profile`
- `/me/cv`
- `/me/subscription`
- `/pricing`

Routes CapCarrière déjà présentes :

- `/cv-ats`
- `/cv-ats/merci`
- `/capcarriere/applications`
- `/capcarriere/applications/:draftId`
- `/admin/capcarriere/drafts/:draftId`

Les routes CapCarrière candidat utilisent déjà un `ProtectedRoute` distinct du `DesiredRoleGate` JobRadar. C'est une bonne base de séparation fonctionnelle. Elles restent cependant rendues dans `AppLayout`, dont la navigation et le footer sont JobRadar.

Les routes d'administration CapCarrière sont imbriquées dans le layout candidat JobRadar et protégées par `AdminRoute`.

### 1.3 Authentification

L'authentification repose sur un client Supabase unique dans `src/lib/supabaseClient.ts` :

- email/mot de passe ;
- OAuth Google ;
- réinitialisation de mot de passe ;
- persistance et renouvellement automatique de session.

La session est stockée avec la clé `go4job.auth` dans le `localStorage` de l'origine. Cette donnée n'est pas partagée automatiquement entre `jobradar.go4jobapp.com` et `capcarriere.go4jobapp.com`, car le stockage navigateur est isolé par origine.

`ProtectedRoute` vérifie uniquement l'existence d'une session. `AdminRoute` ajoute l'appel RPC `is_admin_user`. Les protections produit JobRadar passent actuellement par `usePass` et `JobRadarOnboardingGate`; il n'existe pas de garde d'accès CapCarrière premium.

### 1.4 Intégration Supabase

Le frontend utilise :

- Supabase Auth ;
- PostgREST pour les tables et vues ;
- Supabase Storage, bucket privé `cvs` ;
- RPC PostgreSQL ;
- Edge Functions.

Socle utilisateur partagé observé :

- `profiles`
- `user_cvs`
- `jobs`
- `job_sources`
- `alerts`
- `applications`
- `job_feedback`
- `notification_prefs`
- `billing_plans`
- `billing_plan_prices`
- `billing_payments`
- `billing_subscriptions`
- vue `current_user_pass`

Socle CapCarrière observé :

- `cc_job_apply_intel`
- `cc_application_drafts`
- `cc_application_events`
- `cc_cv_versions`
- `cc_cv_events`
- `cv_ats_leads`
- `cv_ats_events`

Point de vigilance : le frontend et plusieurs fonctions utilisent `billing_plans`, `billing_plan_prices`, `billing_payments`, `billing_subscriptions` et `current_user_pass`, mais les migrations de création initiale de ces objets ne sont pas présentes dans les migrations versionnées visibles. Seules des migrations ultérieures les référencent. Il faut donc reconstituer et versionner le schéma réel avant de faire évoluer les abonnements.

### 1.5 Branding actuel

Le branding global est JobRadar :

- `<title>JobRadar</title>` dans `index.html` ;
- `/jobradar-icon.png` comme favicon et icône Apple ;
- logo Go4Job utilisé comme logo JobRadar dans `AuthPage`, `AppNav`, `PublicHeader`, `ResetPasswordPage` et `DesiredRoleGate` ;
- `PublicHeader`, `SiteFooter`, navigation, prix, pages légales et textes d'authentification écrits pour JobRadar ;
- variables internes analytics préfixées `__jr...`.

CapCarrière possède déjà :

- `src/assets/capcarriere-logo.png` ;
- une identité visuelle autonome dans `CvAtsLandingPage`, `CvAtsThankYouPage`, `CapcarriereApplicationsPage` et `AdminCapcarriereDraftPage` ;
- des classes CSS dédiées `cvats-*`, `cc-candidate-*` et `cap-*`.

Cette identité est locale aux pages : elle n'est pas encore portée par un shell, un document HTML, une navigation ou des pages légales propres à CapCarrière.

## 2. Inventaire JobRadar

| Nom | Chemin | Fonction | Tables Supabase / RPC / fonctions | Branding |
|---|---|---|---|---|
| Entrée unique | `src/main.tsx` | Monte l'application globale et le client Supabase | Client Supabase partagé | Ne sélectionne aucune marque |
| Routeur global | `src/App.tsx` | Déclare toutes les routes et providers | Session, pass et referral via providers | Redirection par défaut vers JobRadar |
| Landing JobRadar | `src/LandingPage.tsx` | Acquisition et présentation du produit | Aucun accès direct | JobRadar, hero `/jobradar-hero-vertical.png` |
| Authentification | `src/AuthPage.tsx` | Inscription, connexion, Google OAuth, reset | Supabase Auth | Textes, logo et redirection JobRadar |
| Reset password | `src/ResetPasswordPage.tsx` | Changement de mot de passe | Supabase Auth | JobRadar |
| Dashboard | `src/HomePage.tsx` | Résume profil, CV, alertes et candidatures | `profiles`, `applications`, `alerts`; fonction `cv_save` | Parcours JobRadar |
| Onboarding | `src/JobRadarOnboardingPage.tsx` | Profil initial, préférences, aperçu, achat, CV, alertes | `jobs`; fonctions `cv_save`; hook onboarding | JobRadar |
| Feed | `src/JobRadarFeedPage.tsx` | Offres, matching, paywall, sauvegarde et feedback | `jobs`, `profiles`, `applications`, `job_feedback`, `alerts`; RPC `save_job`; fonctions `cv_save`, `jobradar_match_feed` | JobRadar |
| Détail offre | `src/JobDetailsPage.tsx` | Consulte une offre, sauvegarde/suit et enrichit | `jobs`, `applications`; fonction `user_generate_ai_desc` | JobRadar |
| Alertes | `src/AlertsPage.tsx` | CRUD des alertes email/WhatsApp/Telegram | `alerts` | JobRadar |
| Suivi de candidatures | `src/ApplicationsPage.tsx` | Suit les offres sauvegardées et leur statut manuel | `applications`, jointure `jobs` | JobRadar |
| Profil | `src/ProfilePage.tsx` | Profil candidat et CV lié au profil | `profiles`, `alerts`, `user_cvs`/alias `cvs`, Storage `cvs` | JobRadar |
| Gestion du CV | `src/MyCvPage.tsx` | Upload, extraction, édition et export DOCX/PDF | `profiles`, `user_cvs`/alias `cvs`, Storage `cvs`; fonctions `cv_save`, `cv_extract` | Actuellement JobRadar malgré une logique réutilisable |
| Tarifs | `src/PricingPage.tsx` | Plans, paiement, pass et historique | `billing_settings`, `billing_plans`, `billing_plan_prices`, `current_user_pass`, `billing_subscriptions`, `billing_payments`; fonctions `paystack_initialize`, `paystack_verify` | JobRadar |
| Bloc de plans | `src/components/PricingPlansBlock.tsx` | Variante intégrable du tunnel tarifaire | Même socle billing et Paystack | JobRadar |
| Abonnement | `src/SubscriptionPage.tsx` | Affiche le pass actif et les paiements | `current_user_pass`, `billing_subscriptions`, `billing_payments`, `billing_plans` | JobRadar |
| Navigation applicative | `src/AppNav.tsx` | Navigation desktop/mobile, admin, compte et déconnexion | `partner_accounts`; RPC `is_admin_user`; Supabase Auth | Shell JobRadar, contient néanmoins un lien CapCarrière |
| Header public | `src/components/PublicHeader.tsx` | Navigation publique | Session | JobRadar |
| Footer global | `src/components/SiteFooter.tsx` | Navigation produit, légale et sociale | Aucun accès direct | JobRadar |
| Gate du poste cible | `src/components/DesiredRoleGate.tsx` | Force le poste recherché avant les écrans JobRadar | `profiles` | JobRadar |
| Gate onboarding | `src/lib/JobRadarOnboardingGate.tsx` | Redirige selon l'avancement JobRadar | Via `useJobRadarOnboarding` | JobRadar |
| Hook onboarding | `src/lib/useJobRadarOnboarding.ts` | Calcule et persiste l'état d'onboarding | `profiles`, `alerts`, `applications`, `current_user_pass` via `usePass` | JobRadar |
| Modèle onboarding | `src/lib/jobradarOnboarding.ts` | Types, étapes, normalisation et routes | Aucun accès direct | JobRadar |
| Matching local | `src/lib/jobMatching.ts` | Score profil/offre, géographie et explications | Aucun accès direct | Logique JobRadar réutilisable par CapCarrière |
| Matching shadow | `src/lib/jobradarShadowFeed.ts`, `src/lib/jobradarShadowAdapter.ts` | Contrats et adaptation du matching serveur | Fonction `jobradar_match_feed` via la page feed | JobRadar |
| Personnalisation | `src/lib/jobradarPersonalization.ts` | Suggestions d'alertes et préférences | Aucun accès direct | JobRadar |
| Conseiller | `src/components/JobRadarAdvisor.tsx`, `jobRadarAdvisorContent.ts` | Conseils contextuels dans feed, CV, alertes et onboarding | `localStorage` | Exclusivement JobRadar |
| Stepper | `src/components/OnboardingStepper.tsx` | Affiche les étapes du parcours | Aucun accès direct | JobRadar |
| Administration santé | `src/AdminHealthPage.tsx`, `src/lib/adminHealthApi.ts` | Santé ingestion, sources, runs et cron | fonction `admin_health` | JobRadar |
| Administration sources | `src/AdminSourcesPage.tsx`, `src/lib/adminApi.ts` | Configure, teste, importe et valide des sources | fonctions admin `admin_list_sources`, `admin_test_source`, `admin_configure_source`, `admin_run_ingest`, `admin_import_source`, `admin_validate_import` | JobRadar |
| Partenaires | `src/BecomePartnerPage.tsx`, `src/PartnerPortalPage.tsx`, `src/AdminPartnersPage.tsx` | Acquisition, portail et administration partenaires | Tables/vues `partner_*`, `admin_partner_summary`; RPC `partner_*` et `admin_*` | Programme JobRadar |
| Analytics landing | `src/components/LandingAnalyticsTracker.tsx`, `src/lib/analytics.ts` | Google Analytics limité à `/landing` | Google Analytics externe | Identifiants internes JobRadar |
| Meta Pixel | `src/components/MetaPixelTracker.tsx`, `src/lib/metaPixel.ts` | Page views et conversions | Meta Pixel externe | Global, mais état interne préfixé JobRadar |
| Emails JobRadar | `supabase/functions/_shared/marketingEmails/templates.ts`, fonctions digest et lifecycle | Digests, réactivation, paiement et marketing | Tables email, alertes, billing; Resend | URLs, logo et wording JobRadar |

Les pages `ContactPage`, `PrivacyPage`, `TermsPage`, `RefundPolicyPage` et `LegalPage` sont globales dans le routeur, mais leur contenu actuel décrit essentiellement JobRadar. Elles doivent donc être considérées comme JobRadar jusqu'à extraction d'une variante légale par produit.

## 3. Inventaire CapCarrière

| Nom | Chemin | Fonction | Tables Supabase / RPC / fonctions | Branding |
|---|---|---|---|---|
| Landing guide CV ATS | `src/CvAtsLandingPage.tsx` | Acquisition gratuite par WhatsApp ou email | `cv_ats_events` via REST; fonction `submit-cv-ats-lead`; Meta Pixel | CapCarrière, logo et CSS dédiés |
| Remerciement CV ATS | `src/CvAtsThankYouPage.tsx` | Qualification du lead puis pont vers JobRadar | fonction `update-cv-ats-lead-qualification`; Meta Pixel | CapCarrière avec CTA JobRadar |
| Dossiers candidat | `src/CapcarriereApplicationsPage.tsx` | Liste, lecture, approbation et refus des dossiers préparés | API `capcarriereApplicationsApi` | CapCarrière dans un shell global JobRadar |
| API dossiers candidat | `src/lib/capcarriereApplicationsApi.ts` | Lit brouillons, événements et CV courant; enregistre une décision | `cc_application_drafts`, `cc_application_events`, `cc_cv_versions`, `jobs`, Storage; RPC `cc_review_application_draft` | Neutre techniquement, spécifique CapCarrière |
| Revue admin dossier | `src/AdminCapcarriereDraftPage.tsx` | Relecture interne détaillée et audit | fonction `admin_capcarriere_draft_review` | CapCarrière |
| API revue admin | `src/lib/adminCapcarriereApi.ts` | Contrat avec la fonction admin de revue | fonction `admin_capcarriere_draft_review` | Spécifique CapCarrière |
| Intelligence de candidature | `supabase/migrations/20260531120000_create_cc_job_apply_intel.sql` | Décrit canal, fiabilité et automatisabilité d'une offre | `cc_job_apply_intel`, référence `jobs` | Backend CapCarrière |
| Brouillons de candidature | `supabase/migrations/20260531150000_create_cc_application_drafts.sql` | Stocke email/lettre avant validation | `cc_application_drafts`, références `profiles`, `jobs`, `applications`, `cc_job_apply_intel` | Backend CapCarrière |
| Audit candidature | `supabase/migrations/20260531162000_add_capcarriere_application_events.sql` | Journalise le cycle du dossier | `cc_application_events` | Backend CapCarrière |
| Versions de CV | `supabase/migrations/20260602130000_create_cc_cv_versions.sql` | Versionne les CV CapCarrière | `cc_cv_versions`, référence `user_cvs`, Storage `cvs` | Backend CapCarrière |
| Audit des CV | `supabase/migrations/20260602140000_create_cc_cv_events.sql` | Journalise le cycle d'une version CV | `cc_cv_events` | Backend CapCarrière |
| Décision candidat | `supabase/migrations/20260622120000_capcarriere_candidate_draft_review.sql` | Approbation/refus atomique sans envoi | RPC `cc_review_application_draft` | Backend CapCarrière |
| Création interne de brouillon | `supabase/functions/create_capcarriere_application_draft/index.ts` | Prévisualise ou crée un brouillon test avec garde-fous | `cc_job_apply_intel`, `jobs`, `cc_application_drafts`, `cc_application_events`, `profiles` | CapCarrière, encore limité à un utilisateur interne |
| Lecture admin | `supabase/functions/admin_capcarriere_draft_review/index.ts` | Agrège dossier, offre, canal, événements et CV | Tables CapCarrière, `jobs`, `job_sources`, `profiles`, Storage | CapCarrière, encore limité à un utilisateur interne |
| Leads CV ATS | `supabase/migrations/20260612120000_create_cv_ats_leads.sql` | Capture et qualifie les leads du guide | `cv_ats_leads` | CapCarrière |
| Événements CV ATS | `supabase/migrations/20260616140000_create_cv_ats_events.sql` | Suit les clics WhatsApp | `cv_ats_events` | CapCarrière |
| Envoi du guide | `supabase/functions/submit-cv-ats-lead/index.ts` | Capture le lead et envoie le guide via Resend | `cv_ats_leads`; API Resend | Sujet CV, signature actuelle « équipe Go4Job » |
| Qualification du lead | `supabase/functions/update-cv-ats-lead-qualification/index.ts` | Enregistre le statut de recherche | `cv_ats_leads` | CapCarrière |
| Asset de marque | `src/assets/capcarriere-logo.png` | Logo frontend | Aucun | CapCarrière |

Fonctionnalités CapCarrière annoncées mais non trouvées dans le code exploré :

- simulateur IA d'entretien ;
- coaching carrière ;
- espace d'analyse ATS complet distinct de l'extraction CV actuelle ;
- optimisation ATS guidée avec versions visibles ;
- navigation et dashboard CapCarrière complets ;
- abonnement CapCarrière distinct ;
- envoi assisté réel de candidatures.

## 4. Éléments mutualisables

### 4.1 Composants

| Élément | Justification issue du code | Cible |
|---|---|---|
| `ToastProvider` / `useToast` | Aucune dépendance de marque; déjà utilisé par les deux produits | `src/shared/ui/toast/` |
| `GuidedUI` | Cartes d'état et actions génériques | `src/shared/ui/guidance/` avec textes fournis par la marque |
| `PaymentMarketPanel` | Présentation EUR/XOF sans logique produit | `src/shared/billing/` |
| Shell technique de layout | `Outlet`, conteneur et providers sont réutilisables; header/footer ne le sont pas | Shell partagé paramétré par une configuration de marque |
| Pages légales structurelles | Les composants sont simples, mais leur contenu est JobRadar | Gabarits partagés + contenu par marque |

### 4.2 Hooks et services

| Élément | Justification issue du code | Cible |
|---|---|---|
| `supabaseClient` | Les deux produits doivent conserver le même projet Supabase | `src/shared/supabase/client.ts` |
| `useSession` / `ProtectedRoute` | Auth commune, aucune logique métier de marque | `src/shared/auth/` |
| `AdminRoute`, `adminAccess` | Autorisation d'équipe transverse | `src/shared/admin/` |
| `usePaymentMarket` | Résolution de devise indépendante du produit, malgré la clé actuelle `jobradar.*` | `src/shared/billing/`, clé renommée/versionnée |
| Referral partenaire | Le programme actuel est JobRadar, mais la capture technique d'un code est générique | moteur partagé, règles d'attribution par produit |
| Analytics/Meta | Chargeurs techniques réutilisables | adaptateur partagé recevant IDs et namespace par marque |

### 4.3 Logique métier et données

| Élément | Justification issue du code | Mutualisation proposée |
|---|---|---|
| Auth et `profiles` | Toutes les pages candidat utilisent le même `auth.uid()` et le même profil | Source utilisateur commune |
| `jobs` et `job_sources` | CapCarrière référence directement les offres JobRadar | Catalogue commun |
| Matching | `jobMatching.ts` et `jobradar_match_feed` calculent la pertinence d'une offre | Service commun; présentation différente selon le produit |
| `alerts` et notification prefs | CapCarrière inclut les fonctionnalités JobRadar | CapCarrière consomme les mêmes alertes |
| `applications` | Suivi simple JobRadar et pont nullable depuis `cc_application_drafts` | Historique commun, avec distinction du type d'origine |
| `user_cvs` et bucket `cvs` | Déjà utilisés par JobRadar; `cc_cv_versions` référence `user_cvs` | Fichier et extraction partagés, cycle de version CapCarrière séparé |
| Billing et paiements | Un seul tunnel Paystack et une seule résolution de marché existent | Billing commun, entitlement par produit |

La mutualisation doit porter sur les capacités et les données, pas sur les textes de marque. Par exemple, le moteur de matching peut être commun, mais `JobRadarAdvisor` et ses messages ne doivent pas être affichés tels quels dans CapCarrière.

## 5. Éléments à séparer

### 5.1 Branding

- `index.html` : titre, description, favicon et `theme-color`.
- Logos et icônes : `go4job-logo.png`, `jobradar-icon.png`, `capcarriere-logo.png`.
- Variables CSS et typographie de marque.
- Noms internes analytics actuellement préfixés `jr`.
- Noms de fichiers exportés comme `*_jobradar.docx` dans `MyCvPage`.

Justification : le document HTML et plusieurs composants globaux imposent actuellement JobRadar même sur des routes CapCarrière.

### 5.2 Navigation et shells

- `AppNav`
- `PublicHeader`
- `SiteFooter`
- `AppLayout`
- landing et dashboard

Justification : `AppNav` place « Mes dossiers CapCarrière » dans le menu Compte JobRadar; `SiteFooter` décrit uniquement JobRadar; les routes CapCarrière candidat utilisent encore ce shell.

Il faut deux shells visibles :

- JobRadar : offres, alertes, suivi simple, profil, pass JobRadar.
- CapCarrière : tableau de bord carrière, CV ATS/versions, candidatures préparées, entretiens, coaching, historique; accès aux fonctions JobRadar dans un espace clairement identifié.

### 5.3 Routes et pages

Les routeurs produit doivent être distincts. Les alias historiques `/`, `/profile`, `/applications` et `/alerts` doivent être supprimés ou redirigés de façon explicite dans le produit JobRadar afin d'éviter des chemins ambigus.

Les pages `AuthPage`, `ResetPasswordPage`, `ContactPage` et les pages légales doivent recevoir une configuration de marque ou avoir une variante par produit.

### 5.4 Pricing et abonnements

`usePass`, `PricingPage`, `PricingPlansBlock` et `SubscriptionPage` supposent actuellement un booléen « pass actif ». Les textes et plans sont JobRadar. CapCarrière doit avoir ses plans, ses avantages, son upgrade et ses protections propres.

### 5.5 Emails

À séparer :

- digest et lifecycle JobRadar ;
- récupération de paiement JobRadar ;
- confirmation de pass JobRadar ;
- guide et nurturing CV ATS CapCarrière ;
- futurs emails transactionnels CapCarrière ;
- futurs emails de candidature, qui exigent consentement et audit.

Les templates actuels contiennent des URLs et logos JobRadar en dur. L'email du guide CapCarrière signe actuellement « L'équipe Go4Job », pas CapCarrière.

### 5.6 Assets

Créer des répertoires dédiés :

- `public/brands/jobradar/`
- `public/brands/capcarriere/`
- `src/brands/jobradar/assets/`
- `src/brands/capcarriere/assets/`

Conserver dans `shared/assets/` uniquement les éléments réellement Go4Job ou fournisseur de paiement.

## 6. Architecture frontend cible

### 6.1 Structure proposée

```text
src/
  entries/
    jobradar.main.tsx
    capcarriere.main.tsx

  brands/
    brand.types.ts
    resolveBrand.ts
    jobradar/
      brand.config.ts
      JobRadarApp.tsx
      JobRadarRoutes.tsx
      JobRadarPublicLayout.tsx
      JobRadarAppLayout.tsx
      pages/
      components/
      assets/
      styles/
    capcarriere/
      brand.config.ts
      CapCarriereApp.tsx
      CapCarriereRoutes.tsx
      CapCarrierePublicLayout.tsx
      CapCarriereAppLayout.tsx
      pages/
      components/
      assets/
      styles/

  shared/
    auth/
    admin/
    billing/
    jobs/
    matching/
    profiles/
    alerts/
    applications/
    cv/
    analytics/
    supabase/
    ui/
    legal/
```

### 6.2 Deux entrées Vite

Créer deux entrées explicites :

- `src/entries/jobradar.main.tsx`
- `src/entries/capcarriere.main.tsx`

Chaque entrée monte ses providers communs puis son application de marque. `VITE_BRAND` sert à sélectionner la configuration et à empêcher un build incohérent :

```text
VITE_BRAND=jobradar
VITE_BRAND=capcarriere
```

Deux stratégies Vite sont possibles :

1. deux fichiers HTML (`jobradar.html`, `capcarriere.html`) déclarés comme inputs Rollup ;
2. un template `index.html` et deux commandes de build qui choisissent l'entrée, les métadonnées et le dossier de sortie selon `VITE_BRAND`.

Pour deux sites Netlify séparés, la deuxième stratégie est la plus simple : même dépôt, même pipeline, variables d'environnement et domaine différents.

Commandes cibles :

```json
{
  "build:jobradar": "cross-env VITE_BRAND=jobradar vite build",
  "build:capcarriere": "cross-env VITE_BRAND=capcarriere vite build"
}
```

La résolution de marque doit échouer au build si `VITE_BRAND` est absent ou invalide. Elle ne doit pas reposer uniquement sur `window.location.hostname`, afin que preview, tests et builds restent déterministes.

### 6.3 Configuration de marque

Chaque `brand.config.ts` doit fournir au minimum :

- `id`
- `name`
- `shortName`
- `baseUrl`
- `logo`
- `favicon`
- `themeColor`
- `documentTitle`
- `defaultDescription`
- `supportEmail`
- `analyticsNamespace`
- routes d'accueil, d'auth et post-login
- contenu légal et footer
- capacités produit visibles

### 6.4 Règle de dépendance

- `shared/` ne doit importer aucun fichier depuis `brands/`.
- Les marques peuvent importer `shared/`.
- JobRadar ne doit pas importer de module `capcarriere/`.
- CapCarrière peut consommer les capacités partagées issues de JobRadar, mais pas ses composants brandés.

## 7. Gestion des sous-domaines

### 7.1 DNS et hébergement

Créer deux sites/deploy targets :

- `jobradar.go4jobapp.com` → build `VITE_BRAND=jobradar`
- `capcarriere.go4jobapp.com` → build `VITE_BRAND=capcarriere`

Chaque sous-domaine doit avoir :

- son enregistrement DNS CNAME/A selon les instructions de l'hébergeur ;
- son certificat TLS ;
- son build command ;
- ses variables d'environnement ;
- son redirect SPA `/* -> /index.html`.

Le `netlify.toml` actuel ne décrit qu'un build. À terme, préférer deux sites Netlify configurés depuis le même dépôt plutôt qu'un unique site qui choisit la marque à l'exécution.

### 7.2 Routage

Chaque build ne doit embarquer que son routeur public :

- JobRadar ne rend pas les pages CapCarrière.
- CapCarrière ne rend pas la landing, le pricing ou le shell JobRadar, mais expose les capacités partagées nécessaires.

Des redirections inter-produit explicites doivent remplacer les liens relatifs actuels. Exemple : le CTA JobRadar de la landing CV ATS doit viser `https://jobradar.go4jobapp.com/...`, pas `/jobradar/feed` sur le domaine CapCarrière.

### 7.3 Authentification et cookies

État actuel :

- Supabase Auth commun ;
- session persistée en `localStorage` sous `go4job.auth` ;
- aucun cookie d'authentification partagé par le frontend ;
- OAuth redirige vers `window.location.origin/auth`.

Conséquence : un utilisateur connecté à JobRadar ne sera pas automatiquement connecté à CapCarrière.

Approche recommandée :

1. Phase initiale sûre : même compte Supabase, mais authentification indépendante sur chaque sous-domaine. Ajouter les deux callbacks exacts dans la liste de redirection Supabase.
2. Phase SSO ultérieure : mettre en place un flux centralisé documenté (callback d'auth commun ou backend d'échange à usage unique). Ne pas transférer de JWT dans l'URL et ne pas copier manuellement le `localStorage`.
3. Si un cookie parent `.go4jobapp.com` est retenu, il doit être `Secure`, `HttpOnly`, `SameSite=Lax` ou plus strict, émis côté serveur et accompagné d'une protection CSRF. Le client Supabase actuel ne fournit pas ce mécanisme à lui seul.

Les cookies Meta `_fbp`/`_fbc` et les données referral doivent aussi être revus : le referral est actuellement stocké en `localStorage`, donc isolé par sous-domaine.

### 7.4 CORS

Plusieurs fonctions utilisent `Access-Control-Allow-Origin: *`, tandis que d'autres ont une allowlist limitée à :

- localhost ;
- `go4jobapp.com` ;
- `jobradar.go4jobapp.com`.

`capcarriere.go4jobapp.com` manque notamment dans les allowlists de `admin_capcarriere_draft_review`, `cv_save`, `cv_extract`, `contact_submit`, `admin_health` et `jobradar_match_feed`.

Lors de la migration :

- ajouter les deux origines aux fonctions réellement partagées ;
- limiter les fonctions spécifiques à leur domaine ;
- remplacer progressivement `*` par des allowlists explicites ;
- conserver `Vary: Origin` ;
- vérifier les headers autorisés pour les appels Supabase.

## 8. Gestion des abonnements

### 8.1 État actuel

Le modèle frontend est binaire :

- `usePass` lit uniquement l'existence d'une ligne dans `current_user_pass` ;
- `has_active_pass(p_user_id)` vérifie une souscription active, sans produit ;
- les routes JobRadar utilisent `hasActivePass` ;
- aucune protection premium CapCarrière n'existe ;
- les plans connus sont `pass_7d`, `pass_30d`, `pass_90d`, tous brandés JobRadar.

### 8.2 Modèle cible

Valeurs métier :

- `free`
- `jobradar_pro`
- `capcarriere_pro`

Le type ne doit pas être seulement stocké dans `profiles`, car l'accès doit rester dérivé d'un abonnement ou d'un entitlement vérifiable. Proposition :

- ajouter `subscription_type` à `billing_plans` ;
- recopier le type acheté dans `billing_subscriptions` pour figer le contrat ;
- exposer une vue `current_user_entitlements` ;
- considérer `free` comme l'absence de souscription payante active ;
- donner à `capcarriere_pro` les entitlements `capcarriere_pro` **et** `jobradar_pro`.

Exemple de résolution :

```text
capcarriere_pro > jobradar_pro > free
```

La vue devrait retourner :

- `subscription_type`
- `has_jobradar_access`
- `has_capcarriere_access`
- `starts_at`
- `ends_at`
- `source_subscription_id`

### 8.3 Protections frontend

Créer :

- `useEntitlements()`
- `RequireJobRadarAccess`
- `RequireCapCarriereAccess`

Ces gardes améliorent l'expérience mais ne constituent pas une sécurité suffisante.

### 8.4 Protections backend et RLS

Créer un helper backend de type :

```text
has_product_access(auth.uid(), 'jobradar_pro')
has_product_access(auth.uid(), 'capcarriere_pro')
```

Les tables CapCarrière doivent vérifier à la fois :

- la propriété `user_id = auth.uid()` ;
- l'entitlement CapCarrière actif pour les fonctionnalités premium.

Les RPC et Edge Functions doivent refaire ce contrôle. Les politiques actuelles de `cc_application_drafts` et `cc_cv_versions` vérifient seulement le propriétaire; elles ne distinguent pas le niveau d'abonnement.

Les fonctions `create_capcarriere_application_draft` et `admin_capcarriere_draft_review` contiennent encore un `INTERNAL_TEST_USER_ID`. Ce garde-fou de test doit être remplacé par des rôles et entitlements avant généralisation.

### 8.5 Flow d'upgrade

1. L'utilisateur JobRadar voit une proposition d'upgrade vers CapCarrière.
2. Le checkout envoie explicitement `subscription_type=capcarriere_pro` ou un `plan_code` relié à ce type.
3. `paystack_initialize`, webhook et vérification conservent ce type dans le paiement et la souscription.
4. Après paiement, `current_user_entitlements` donne immédiatement les accès CapCarrière et JobRadar.
5. L'utilisateur est redirigé vers `https://capcarriere.go4jobapp.com/onboarding` ou son dashboard.

Pour un utilisateur ayant déjà `jobradar_pro`, définir avant implémentation une règle commerciale unique :

- remplacement à la date d'achat ;
- extension/calcul de crédit ;
- ou coexistence avec priorité CapCarrière.

Pour une première version sans prorata, la coexistence avec priorité `capcarriere_pro` est la plus simple techniquement, à condition que les dates et l'affichage soient explicites.

## 9. Gestion du branding

### 9.1 Logos et assets

Établir un manifeste par marque et interdire les imports directs d'assets depuis les pages partagées. Les assets de paiement restent partagés.

### 9.2 Favicon, couleurs et HTML

Les métadonnées doivent être générées au build selon `VITE_BRAND` :

| Élément | JobRadar | CapCarrière |
|---|---|---|
| Titre | `JobRadar` | `CapCarrière` |
| Favicon | icône JobRadar | icône CapCarrière à créer si nécessaire |
| Theme color | palette JobRadar | palette CapCarrière |
| Description | veille et matching | accompagnement carrière premium |

Les tokens CSS doivent être séparés :

- `brands/jobradar/styles/tokens.css`
- `brands/capcarriere/styles/tokens.css`
- `shared/ui/tokens.base.css`

### 9.3 Navigation et wording

Les textes doivent venir de la marque ou du produit, pas être codés dans les composants partagés. Exemples actuels à corriger lors de la migration :

- `Ton espace JobRadar` dans l'auth ;
- `Mon accès JobRadar` dans le compte ;
- `Conseiller JobRadar` dans les composants CV ;
- `JobRadar est un produit Go4Job` dans le footer ;
- `_jobradar.docx` dans les exports CV.

### 9.4 Emails transactionnels

Créer un registre de marque commun :

```text
brand
from_name
from_email
reply_to
base_url
logo_url
support_email
footer
legal_url
unsubscribe_url
```

Chaque événement email doit porter un `brand` explicite. Ne pas déduire la marque uniquement de l'URL ou du nom de la fonction.

Les emails de digest et lifecycle restent JobRadar. Les emails CV ATS, coaching, candidature préparée et entretiens deviennent CapCarrière. Les emails d'auth Supabase doivent être neutres Go4Job ou disposer de templates compatibles avec les deux produits.

### 9.5 Analytics

Les deux marques doivent avoir :

- des namespaces d'événements distincts ;
- idéalement des propriétés ou flux GA séparés ;
- des pixels Meta configurables par environnement ;
- des consentements et pages privacy cohérents.

Le Meta Pixel est actuellement monté globalement sur toutes les routes et possède un ID par défaut codé dans le source. Ce comportement doit devenir explicite par marque et par environnement.

## 10. Risques techniques

| Risque | Probabilité | Impact | Mitigation |
|---|---:|---:|---|
| Session non partagée entre sous-domaines à cause du `localStorage` | Élevée | Élevé | Accepter une reconnexion en phase 1; concevoir ensuite un SSO serveur sécurisé |
| Schéma billing incomplet dans les migrations versionnées | Élevée | Élevé | Exporter le schéma réel, créer une baseline et tester un reset local avant toute évolution |
| Accès CapCarrière contrôlé seulement par propriété, sans entitlement | Élevée | Élevé | Ajouter un helper backend et renforcer RLS/RPC/Edge Functions |
| CapCarrière embarqué dans le shell JobRadar | Élevée | Moyen/élevé | Deux layouts et deux routeurs de marque |
| URLs relatives inter-produit cassées après séparation | Élevée | Élevé | Centraliser les `baseUrl` et utiliser des liens absolus inter-domaines |
| Allowlist CORS sans domaine CapCarrière | Élevée | Élevé | Inventorier chaque fonction et appliquer une matrice d'origines |
| Fonctions CapCarrière limitées à un utilisateur interne | Élevée | Élevé | Remplacer les IDs codés en dur par rôles, RLS et entitlements |
| Mélange `profiles.cv_file_path`, `user_cvs` et `cc_cv_versions` | Élevée | Élevé | Définir la source de vérité CV et une stratégie de migration/versionnement |
| Duplication actuelle entre `PricingPage` et `PricingPlansBlock` | Moyenne | Moyen | Extraire un service et des composants billing partagés, avec contenu par produit |
| Emails et URLs JobRadar codés en dur | Élevée | Moyen/élevé | Registre de marque et templates paramétrés |
| Referral et état de paiement en storage isolé par domaine | Moyenne | Moyen | Persister côté backend avant changement de domaine ou transmettre un code court non sensible |
| Meta Pixel global et ID par défaut dans le code | Moyenne | Moyen | Configuration par marque/environnement et gestion du consentement |
| Pages légales décrivant uniquement JobRadar | Élevée | Élevé | Produire des documents CapCarrière adaptés avant mise en ligne |
| Deux builds divergent au fil du temps | Moyenne | Élevé | Shared strict, tests par marque et CI matricielle |
| La table `applications` mélange sauvegarde et « envoyé » manuel | Moyenne | Moyen | Ajouter une origine/type et clarifier le lien avec `cc_application_drafts` |
| Absence de tests automatisés visible dans `package.json` | Élevée | Moyen/élevé | Ajouter tests unitaires shared, routing par marque et tests E2E des entitlements |

## 11. Roadmap de migration

### Étape 0 — Baseline et inventaire de production

- **Objectif** : rendre le schéma et les comportements actuels reproductibles.
- **Durée estimée** : 2 à 4 jours.
- **Fichiers concernés** : `supabase/migrations/`, `supabase/config.toml`, documentation d'environnement.
- **Travaux** :
  - exporter la définition réelle des objets billing absents des migrations ;
  - vérifier les RLS de toutes les tables utilisées ;
  - inventorier les secrets, callbacks OAuth et URLs de production ;
  - documenter les routes réellement utilisées.
- **Risques** : divergence entre production et dépôt.
- **Critère de validation** : un `supabase db reset` local recrée le schéma utile et le frontend compile contre cette baseline.

### Étape 1 — Introduire les frontières de modules sans changer l'UX

- **Objectif** : déplacer le code vers `shared/`, `brands/jobradar/` et `brands/capcarriere/` tout en gardant le comportement courant.
- **Durée estimée** : 4 à 7 jours.
- **Fichiers concernés** : `src/App.tsx`, `src/main.tsx`, `src/components/`, `src/lib/`, toutes les pages.
- **Travaux** :
  - extraire auth, Supabase, UI, matching, profil, alertes, CV et billing ;
  - déplacer les pages JobRadar et CapCarrière ;
  - ajouter des règles d'import.
- **Risques** : imports circulaires et régressions de routing.
- **Critère de validation** : mêmes routes et mêmes écrans, build/typecheck/lint ciblé et smoke tests réussis.

### Étape 2 — Configuration de marque et deux entrées Vite

- **Objectif** : produire deux bundles déterministes.
- **Durée estimée** : 2 à 4 jours.
- **Fichiers concernés** : `vite.config.ts`, `index.html`, `.env.example`, `package.json`, nouveaux `src/entries/` et `src/brands/*/brand.config.ts`.
- **Travaux** :
  - ajouter `VITE_BRAND` ;
  - créer les deux entrées ;
  - générer titre, favicon, description et thème ;
  - ajouter une CI de build pour chaque marque.
- **Risques** : assets ou variables manquants dans l'un des builds.
- **Critère de validation** : deux builds indépendants affichent la bonne marque et ne contiennent pas les routes visibles de l'autre produit.

### Étape 3 — Séparer les shells, routes et contenus publics

- **Objectif** : obtenir deux produits clairement distincts côté utilisateur.
- **Durée estimée** : 4 à 6 jours.
- **Fichiers concernés** : `AppNav`, `PublicHeader`, `SiteFooter`, `AppLayout`, `LandingPage`, `AuthPage`, pages légales, pages CapCarrière.
- **Travaux** :
  - créer navigation, dashboard et footer CapCarrière ;
  - conserver le shell JobRadar centré sur offres/alertes ;
  - rendre les liens inter-produit absolus ;
  - séparer contact, pricing et documents légaux.
- **Risques** : liens relatifs et redirections post-login incorrects.
- **Critère de validation** : aucun écran CapCarrière ne montre un header/footer JobRadar et inversement.

### Étape 4 — Faire évoluer le modèle d'abonnement

- **Objectif** : introduire `free`, `jobradar_pro`, `capcarriere_pro`.
- **Durée estimée** : 4 à 7 jours.
- **Fichiers concernés** : migrations billing, `usePass`, `PricingPage`, `PricingPlansBlock`, `SubscriptionPage`, fonctions Paystack.
- **Travaux** :
  - ajouter le type aux plans/souscriptions ;
  - créer `current_user_entitlements` ;
  - adapter le checkout et le webhook ;
  - créer les hooks et guards produit.
- **Risques** : activation incorrecte ou double souscription.
- **Critère de validation** :
  - free n'accède à aucun premium ;
  - JobRadar Pro accède uniquement au premium JobRadar ;
  - CapCarrière Pro accède à CapCarrière et à JobRadar.

### Étape 5 — Renforcer le backend CapCarrière

- **Objectif** : sécuriser les capacités premium pour de vrais utilisateurs.
- **Durée estimée** : 4 à 8 jours.
- **Fichiers concernés** : migrations `cc_*`, RPC `cc_review_application_draft`, fonctions `create_capcarriere_application_draft`, `admin_capcarriere_draft_review`, API frontend CapCarrière.
- **Travaux** :
  - remplacer les IDs internes codés en dur ;
  - ajouter les contrôles d'entitlement ;
  - définir la source de vérité CV ;
  - tester les transitions et événements d'audit.
- **Risques** : exposition d'un dossier d'un autre utilisateur ou transition invalide.
- **Critère de validation** : tests RLS négatifs/positifs et tests atomiques approve/reject réussis.

### Étape 6 — Séparer les emails, analytics et assets

- **Objectif** : supprimer les fuites de marque.
- **Durée estimée** : 3 à 5 jours.
- **Fichiers concernés** : templates email, fonctions digest/CV ATS/billing, `analytics.ts`, `metaPixel.ts`, `public/`, `src/assets/`.
- **Travaux** :
  - registre de marque ;
  - URLs et logos par produit ;
  - namespaces analytics ;
  - assets rangés par marque.
- **Risques** : email envoyé avec mauvais logo ou mauvais domaine.
- **Critère de validation** : snapshots/preview d'emails et événements analytics correctement attribués aux deux marques.

### Étape 7 — Préparer les sous-domaines et l'auth

- **Objectif** : déployer les deux builds sans coupure.
- **Durée estimée** : 2 à 4 jours hors propagation DNS.
- **Fichiers concernés** : configuration d'hébergement, variables d'environnement, callbacks Supabase, CORS des Edge Functions.
- **Travaux** :
  - créer deux sites ;
  - configurer TLS et DNS ;
  - autoriser les callbacks OAuth des deux domaines ;
  - appliquer la matrice CORS ;
  - décider explicitement si la phase 1 demande une reconnexion.
- **Risques** : boucles OAuth, session absente, fonctions bloquées par CORS.
- **Critère de validation** : inscription, connexion, reset, logout et appels backend fonctionnent sur les deux sous-domaines.

### Étape 8 — Migration progressive et observabilité

- **Objectif** : basculer le trafic avec possibilité de retour arrière.
- **Durée estimée** : 3 à 5 jours.
- **Fichiers concernés** : redirects, analytics, dashboards santé, documentation d'exploitation.
- **Travaux** :
  - déployer d'abord en preview ;
  - exécuter les parcours E2E ;
  - activer CapCarrière pour un groupe pilote ;
  - surveiller auth, paiements, CORS, erreurs et conversions ;
  - conserver temporairement des redirects depuis les anciennes routes.
- **Risques** : baisse de conversion, liens historiques cassés.
- **Critère de validation** : métriques stables, aucun accès croisé non autorisé et rollback documenté.

### Ordre recommandé

Ne pas commencer par le DNS ou par une duplication du dépôt. L'ordre le plus sûr est :

1. baseline backend ;
2. frontières de code ;
3. builds et shells séparés ;
4. entitlements ;
5. sécurité backend ;
6. marque/emails/analytics ;
7. sous-domaines ;
8. migration progressive.

Cette séquence conserve le backend partagé voulu, évite de dupliquer la logique métier et traite avant la mise en ligne les deux risques les plus importants observés : le modèle de pass binaire et la session non partagée entre origines.
