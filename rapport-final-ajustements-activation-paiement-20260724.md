Rapport final — Ajustements activation et paiement JobRadar
Session Cowork du 24 juillet 2026 — branche dev, projet Supabase go4job (fygsoucyzmfainnbdpvw)

---

## 1. Flux réel trouvé dans le code

Avant toute modification, le flux réel a été reconstitué depuis le code (frontend, RPC, Edge Functions), pas depuis des suppositions :

- L'onboarding JobRadar (`JobRadarOnboardingPage.tsx`) menait un utilisateur à un écran "unlock" sans jamais créer d'alerte gratuite : l'alerte n'était créée qu'après un achat de pass. Un utilisateur qui abandonnait avant paiement repartait sans rien, alors que le produit est censé fonctionner en partie gratuitement.
- Le "gate" d'onboarding (`JobRadarOnboardingGate`) ne couvre que `/`, `/applications`, `/jobradar/applications`, `/jobradar/jobs/:id` — `/jobradar/feed` n'est pas gated, ce qui explique pourquoi certains utilisateurs atteignaient le feed sans être passés par l'onboarding.
- Le paiement Paystack repose sur trois points d'entrée : le webhook (`paystack_webhook`, vérification HMAC-SHA512 en temps constant, idempotent), le retour utilisateur (`paystack_verify`, appelé au retour sur `/pricing`), et — depuis cette session — un filet de rattrapage serveur (`paystack_reconcile_pending`, Ajustement 6). Avant cette session, seuls les deux premiers existaient : un utilisateur qui payait puis fermait l'onglet avant confirmation dépendait entièrement du webhook.
- `paystack_verify` traitait tout statut différent de "succès" comme un échec, y compris `pending`/`ongoing` — fréquents en mobile money (confirmation sur le téléphone, potentiellement différée). Ce faux échec effaçait aussi la référence de paiement en session, rendant toute reprise automatique impossible.
- La cible de rôle libre saisie à l'onboarding (texte libre, ex. "08041889" trouvé en base) était utilisée comme filtre de récupération d'offres : sur un échantillon réel, 41 % de ces rôles ne correspondaient littéralement à aucune offre active, produisant un feed vide sans explication. Corrigé avant cette session : le rôle cible reste un signal de pertinence, jamais un filtre bloquant.
- La recherche texte du feed (`fetchJobsSearch`) plantait avec une erreur serveur générique dès qu'un mot-clé réel était saisi (ex. "mine") : deux appels `.or()` chaînés sur la même requête Supabase produisaient deux paramètres `or=` dans l'URL, que PostgREST ne sait pas combiner. Découvert cette session via les logs API réels, après un signalement direct de l'utilisateur.
- `paystack_verify` contenait un bug silencieux (découvert cette session) : quand un paiement était déjà marqué "paid" mais sans pass actif, l'échec éventuel de l'activation n'était pas remonté — la fonction répondait quand même succès, ce qui aurait pu faire croire à tort qu'un pass était actif.

## 2. Hypothèses confirmées / infirmées

- Confirmé : aucune alerte n'était créée avant paiement (hypothèse de départ).
- Confirmé : le plafond du pass payant est de 3 alertes actives, pas illimité comme supposé initialement.
- Infirmé : il n'existe pas de mécanisme de priorité d'affichage des offres lié au pass (aucune colonne ni logique trouvée en base ou dans le matching).
- Confirmé : `emploisenegal_portal` fixe `country_codes = ["SN"]` en dur via un filtre sur l'URL de catégorie — fiable tant que la structure du site ne change pas, mais la source est bloquée par Cloudflare depuis mai 2026.
- Infirmé : `projobivoire_rss` n'est pas limité à l'Afrique de l'Ouest malgré son nom — panafricain dans les faits (CI, Gabon, Maroc, Mauritanie, Maurice, Rwanda, Tchad, Afrique du Sud constatés en données réelles).
- Confirmé : le pipeline `paystack_checkout_recovery_leads` / `enqueue_paystack_recovery` est un import ponctuel figé (colonne `imported_at`), sans cron de rafraîchissement — non utilisé comme base pour les relances de cette session (Ajustement 8), qui lit directement `billing_payments`, la source vivante.

## 3. Définition exacte gratuit vs payant

- Gratuit : une alerte active, créée automatiquement (avec consentement explicite) à la fin de l'onboarding, quel que soit l'aboutissement du paiement. Un utilisateur gratuit avec une alerte manuelle préexistante n'en obtient pas une deuxième : la limite reste 1 alerte active.
- Payant (`pass_7d` 7 jours, `pass_30d` 30 jours, `pass_90d` 90 jours) : jusqu'à 3 alertes actives, accès complet au feed (le mode gratuit reste en aperçu limité), aucun renouvellement automatique.
- Aucune différence de priorité de matching entre gratuit et payant — uniquement une différence de quota d'alertes et d'accès au feed complet.

## 4. Nouveau flux implémenté

1. L'utilisateur valide l'onboarding (avec ou sans profil complet) → consentement explicite affiché → une alerte gratuite est créée automatiquement via une RPC idempotente (`jobradar_upsert_onboarding_alert`), jamais dupliquée même en cas de double clic ou de double appel réseau (garde applicative + index unique partiel en base).
2. L'écran "unlock" a été réécrit pour refléter les capacités réelles (accès complet au feed, jusqu'à 3 alertes, pas de mécanisme de priorité inventé) plutôt que des promesses génériques.
3. Un utilisateur gratuit qui a déjà son alerte n'est plus jamais bloqué à l'écran unlock : `computeNextStep` le laisse continuer ("done") au lieu de boucler.
4. La recherche du feed fonctionne à nouveau pour tout mot-clé, et propose en option (jamais automatique) un élargissement des résultats quand la recherche stricte ne trouve rien, sans jamais modifier les critères enregistrés d'une alerte.
5. Le paiement affiche un écran d'attente dédié qui distingue explicitement : vérification en cours, paiement en cours de confirmation (mobile money), paiement confirmé mais activation en cours, et timeout — avec la référence de paiement toujours visible pour un contact support éventuel.

## 5. Stratégie comptes existants

Un utilisateur déjà inscrit, sans alerte, voit une bannière non bloquante sur le feed (`OnboardingAlertInviteBanner`) l'invitant à créer son alerte gratuite en un clic, sans repasser par tout l'onboarding. En parallèle, une relance email unique (jamais une séquence) a été envoyée à ce segment via une Edge Function isolée (`jobradar_alert_reactivation_send`), en réutilisant la vue existante `jobradar_marketing_reactivation_candidates` (qui exclut déjà emails de test, suppressions, utilisateurs payants/avec pass actif, et tout envoi déjà fait sous la même clé). 214 destinataires réels éligibles confirmés par requête directe avant envoi. La campagne marketing existante (`non_paying_without_alert` / `create_alert_email_1`, toujours active en cron quotidien) n'a volontairement pas été modifiée pour ne pas risquer de régression sur un mécanisme déjà en production.

## 6. Architecture de rapprochement Paystack (Ajustement 6)

`paystack_reconcile_pending` est un filet, pas un remplacement du webhook ni de `paystack_verify` :
- Ne vérifie que les paiements `pending`/`ongoing` récents (fenêtre configurable, 48 h par défaut, plafond dur 14 jours).
- Ne réutilise que l'appel officiel `GET /transaction/verify/:reference` de Paystack — jamais une activation basée sur la simple présence d'une référence.
- Toute transition de statut passe par `billing_apply_payment_update(..., p_only_if_statuses: ['pending','ongoing'])`, qui refuse d'écraser un statut déjà final (vérifié ce jour : une tentative de forcer un paiement "paid" vers "failed" via ce garde-fou a été rejetée, statut inchangé).
- Ne marque jamais un paiement "expired" unilatéralement : au-delà de `max_attempts`, le paiement sort simplement de la sélection automatique, aucun statut inventé.
- `dry_run` par défaut (aucune écriture sans `dry_run:false` explicite), protégée par `CRON_SECRET`.

## 7. Bornes et garde-fous des crons

- `paystack_reconcile_pending` : 10 paiements par défaut (max 30), fenêtre 48 h (plafond 14 jours), max 10 tentatives par paiement.
- `jobradar_payment_reminder_send` : 5 relances par défaut (max 20), fenêtre 72 h, 1ʳᵉ relance après 10 min, 2ᵉ après 24 h, jamais de 3ᵉ (clé email dédiée par étape, vérifiée via `email_logs`).
- Écran d'attente paiement (frontend) : jusqu'à 8 tentatives espacées de 8 s, jamais plus de 5 minutes d'horloge murale, suspendu tant que l'onglet n'est pas visible.
- **Aucun de ces deux crons n'est encore planifié** (`cron.job` vérifié ce jour : seuls les deux jobs de l'ancienne campagne marketing existent, `10 9 * * *` et `20 9 * * *`). Les fonctions sont déployées et sûres par défaut (dry-run), mais un appel manuel ou une planification explicite reste à décider avec vous.

## 8. Relances en place

- Relance de réactivation (Ajustement 3) : envoi unique déjà effectué à 214 comptes existants sans alerte.
- Relances de paiement en attente (Ajustement 8) : mécanisme prêt et déployé, mais non planifié (voir §7). Exclut systématiquement les paiements supplantés par un achat déjà confirmé (vérifié ce jour par simulation en transaction annulée), les emails désabonnés/suppressed, et respecte les clés de déduplication par étape.

## 9. Événements Analytics

Extension de `src/lib/analytics.ts` avec un allowlist strict de paramètres et filtrage PII, gating production + consentement uniquement. Événements ajoutés et câblés sur de vrais points du parcours : `preferences_validated`, `alert_consent_given`, `preview_shown`, `preview_no_exact_match`, `upgrade_screen_shown`, `continued_free`, `pass_selected`, `widened_results_offered/accepted/declined` (Ajustement 5), `payment_pending`, `payment_confirmed` (avec `confirmation_path`: webhook / user_return / scheduled_reconciliation), `reminder_sent`, `payment_recovered_after_reminder`, `pass_activated`, `alert_reactivation_banner_shown/clicked`.

## 10. Tests effectués

Sans accès navigateur direct dans ce contexte, les tests ont porté sur les mécanismes réels côté serveur (SQL exécuté en transaction avec `ROLLBACK` systématique — aucune trace laissée en production) et sur le code lui-même. Résultats :

Activation :
- Création idempotente de l'alerte onboarding : deux appels consécutifs → une seule ligne, mise à jour et non duplication (vérifié sur un vrai compte). Réussi.
- Limite gratuite (1 alerte active) : un compte gratuit réel avec une alerte manuelle existante ne reçoit pas de deuxième ligne, la RPC renvoie l'alerte existante. Réussi.
- Garde-fou base de données (index unique partiel `alerts_one_onboarding_per_user`) présent et actif, indépendant de la logique applicative. Réussi.
- RLS sur `alerts` : lecture/écriture/suppression strictement limitées à `user_id = auth.uid()` sur les 4 opérations. Réussi.
- Recherche texte : requête équivalente à la recherche corrigée validée en SQL direct, résultats cohérents avec l'ancien comportement attendu. Réussi.
- Élargissement de recherche (Ajustement 5) : cas réel identifié où la recherche stricte ne renvoie aucun résultat mais un pool élargi de plus de 13 000 offres existe (mots recherchés séparément présents) — confirme que la condition de déclenchement de l'offre d'élargissement se produit bien en pratique. Réussi.

Paiement :
- Paiement réel de 1500 FCFA (voir §11).
- Idempotence de `activate_pass_from_payment` : rejoué sur le vrai paiement déjà activé, aucune duplication de souscription. Réussi.
- Garde-fou `billing_apply_payment_update` (`p_only_if_statuses`) : tentative de forcer un paiement "paid" vers "failed" refusée, statut inchangé. Réussi.
- Requêtes de sélection de `paystack_reconcile_pending` et `jobradar_payment_reminder_send` rejouées telles quelles contre la production : 0 candidat dans les deux cas, cohérent avec l'état réel (aucun paiement pending/ongoing récent au moment du test). Réussi.
- Garde-fou "supplanté par un achat confirmé" des relances : simulé en transaction annulée, correctement détecté. Réussi.
- Aucun cron ne référence les nouvelles fonctions (déployées mais non planifiées, comme documenté). Confirmé.
- Crons marketing existants non modifiés (2 jobs actifs, campagne inchangée). Confirmé.

Non testés ici (nécessitent un vrai navigateur / clic utilisateur) : rendu visuel des nouveaux écrans (bannière, offre d'élargissement, carte d'attente paiement), déclenchement réel des événements GA4 en conditions de navigation, vérification manuelle du statut `paid_activation_pending` en conditions réelles (nécessiterait de provoquer un vrai échec de RPC, ce qui n'est pas sûr à simuler en production). Recommandation : un passage manuel rapide de votre part sur le parcours onboarding → unlock → recherche → paiement suffirait à couvrir ce qui reste.

## 11. Résultat du paiement réel

1500 FCFA, pass 7 jours, mobile money, compte kacoutiedieudonne@gmail.com. Webhook Paystack reçu et traité en 38 secondes, statut passé à "paid", pass activé sans doublon de souscription, montant et devise vérifiés (garde anti-fraude amount/currency mismatch non déclenchée). Aucune anomalie.

## 12. Fichiers et migrations modifiés

Migration appliquée directement en production (additive, non destructive) : `20260724100000_jobradar_onboarding_alert_consent.sql` (colonne `alerts.source`, contrainte de vérification, index unique partiel, RPC `jobradar_upsert_onboarding_alert`).

17 fichiers modifiés au total sur `dev`, +2360/-68 lignes : `JobRadarFeedPage.tsx`/`.css`, `JobRadarOnboardingPage.tsx`/`.css`, `PricingPage.tsx`/`.css`, `components/OnboardingAlertInviteBanner.tsx`/`.css` (nouveau), `components/PricingPlansBlock.tsx`, `lib/analytics.ts`, `lib/onboardingAlert.ts` (nouveau), `lib/useJobRadarOnboarding.ts`, `supabase/functions/paystack_verify/index.ts`, et trois nouvelles Edge Functions (`jobradar_alert_reactivation_send`, `jobradar_payment_reminder_send`, `paystack_reconcile_pending`).

## 13. Edge Functions et crons déployés

Déployées et actives : `jobradar_alert_reactivation_send` (v1), `paystack_reconcile_pending` (v1), `jobradar_payment_reminder_send` (v1), `paystack_verify` (v34, mise à jour). Aucune de ces fonctions n'est protégée différemment de leurs équivalentes existantes (JWT ou `CRON_SECRET` selon le cas). Aucun nouveau cron créé — les deux fonctions de filet/relance restent à planifier sur décision explicite de votre part (voir §7).

## 14. Mesures avant / après

- Couverture `country_codes` sur les offres actives : 35 % → 99,9 % (audit du 20/07/2026, avant cette session).
- Recherche texte du feed : 0 % de requêtes fonctionnelles (erreur systématique) → fonctionnelle, vérifiée en SQL direct.
- Paiements confirmés (`paid`/`paid_test`) : 6 → 7 après le test réel de cette session.
- Comptes réactivés potentiels touchés par la relance unique : 214 (Ajustement 3).
- Alertes gratuites : mécanisme inexistant avant cette session → opérationnel et idempotent, vérifié sur données réelles.

## 15. Risques restants

- Les deux nouveaux crons (réconciliation, relances) ne tournent pas encore : tant qu'ils ne sont pas planifiés, le filet de sécurité Ajustement 6 et les relances Ajustement 8 n'agissent pas automatiquement, seul un appel manuel les déclencherait.
- Le statut `paid_activation_pending` (nouveau, correctif du bug d'activation silencieuse) n'a pas pu être déclenché en conditions réelles sans provoquer un vrai échec RPC — sa logique est vérifiée par relecture de code et typage strict, pas par un cas réel observé.
- La campagne marketing existante (`non_paying_without_alert`) tourne toujours en parallèle de la nouvelle alerte gratuite automatique : chevauchement fonctionnel possible, à trancher avec vous (pause ou fusion).
- `rss_ngojobsinafrica` reste sans pays exploitable par offre (signalé, non traité — hors périmètre de cette session).
- `emploisenegal_portal` reste bloqué par Cloudflare depuis mai 2026 ; à réauditer si le blocage se lève.
- Aucun test de bout en bout via un vrai navigateur n'a pu être exécuté dans cet environnement (voir §10) : un passage manuel rapide est recommandé avant toute campagne d'acquisition.

## 16. Plan de rollback

- Tout est sur `dev`, jamais poussé sur une branche de production ni fusionné (voir §17) : un rollback complet consiste à ne pas fusionner `dev`.
- La migration appliquée est additive uniquement (nouvelle colonne avec défaut, nouvel index, nouvelle RPC) : aucune donnée existante modifiée, un rollback SQL propre consisterait à `DROP FUNCTION jobradar_upsert_onboarding_alert`, `DROP INDEX alerts_one_onboarding_per_user`, `ALTER TABLE alerts DROP COLUMN source` — non fait, à valider avec vous si nécessaire.
- Les Edge Functions déployées sont additives (nouvelles fonctions) sauf `paystack_verify`, modifiée : la version précédente (v33) reste consultable via `get_edge_function` et peut être redéployée telle quelle si besoin.
- Aucun cron n'a été activé pour les nouveaux mécanismes : rien à désactiver en cas de rollback.

## 17. État branche / commit / push / déploiement

- Branche : `dev`, 8 commits locaux, non poussés (aucun accès `git push` disponible depuis cet environnement — la copie locale sur votre machine contient déjà tous les commits, un `git push origin dev` de votre part suffit).
- Base de données : migration appliquée directement en production via l'outil MCP Supabase (choix assumé : additive et non destructive, le frontend en dépendait).
- Edge Functions : déployées et actives en production (voir §13), code déployé strictement identique au code commité sur `dev`.
- Aucun commit poussé, aucune fusion vers une branche de production, aucun cron activé sans votre validation explicite.
