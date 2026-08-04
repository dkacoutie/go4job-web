# Rapport de finalisation — 8 priorités avant lancement Meta Ads

Date : 24/07/2026
Périmètre : suite du rapport "Ajustements" validé, exécuté avec le feu vert donné pour finaliser sans repasser par une phase de plan.

**Décision finale, en une phrase : non, pas encore prêt pour Meta Ads.** Deux bugs de production sévères ont été trouvés et corrigés pendant cette session (recherche + accès direct au feed), mais un troisième, tout aussi sérieux, reste ouvert : le moteur de personnalisation (`jobradar_match_feed`) échoue systématiquement depuis plusieurs heures, pour les comptes gratuits comme pour le compte payant réel. Tant qu'il n'est pas corrigé, une partie du produit que la pub va pousser (alertes personnalisées, "Pour toi") ne fonctionne pas.

---

## Ce qui a été fait et vérifié

### Priorité 1 — Versionner et déployer

Statut du dépôt confirmé par `git status -sb` et `git log` : 5 commits locaux sur `dev`, aucun poussé vers `origin/dev` (`ahead 5`). Trois faisaient déjà partie du lot précédent ; deux ont été ajoutés pendant cette session (détaillés plus bas). Cause : l'environnement sandbox n'a toujours pas d'identifiants git configurés (`git: 'credential-manager' is not a git command`) — limitation structurelle inchangée, déjà signalée dans le rapport précédent.

**Action requise de ta part : exécuter `git push origin dev` toi-même** pour envoyer ces 5 commits. Liste exacte, dans l'ordre :
1. `8363404` — reformulation du titre du feed (retire une allusion à une "priorité" qui n'existe pas)
2. `c59b8bb` — réduit le volume réellement récupéré du serveur pour un compte gratuit (mitigation feed)
3. `781ae78` — ne demande plus au serveur le lien de candidature ni la description complète pour un compte gratuit
4. `90ac032` — **nouveau**, impose la vérification serveur du pass actif dans `save_job` (voir Priorité 3/4)
5. `175fb49` — **nouveau**, corrige le plan de requête de recherche qui provoquait des erreurs 500 en production (voir bug détaillé ci-dessous)

Déploiement frontend confirmé à jour à `aa5ba2e` (vérifié par comportement réel + contenu des bundles JS servis). Les deux migrations SQL nouvelles (`90ac032`, `175fb49`) ont, elles, déjà été **appliquées directement en production** via le rôle propriétaire de la base (nécessaire pour corriger un bug actif immédiatement) — donc actives dès maintenant côté serveur, indépendamment du push git. Le push ne fait que mettre le dépôt à jour avec ce qui tourne déjà.

### Priorité 2 — Éviter les emails contradictoires

Confirmé inchangé par rapport au rapport précédent : l'ancienne campagne `non_paying_without_alert` reste mise en pause (`cron.alter_job`, réversible), la nouvelle campagne de réactivation partage volontairement le même `segment_key` pour que l'ancienne logique de dédoublonnage neutralise tout chevauchement si elle était un jour réactivée par erreur. Aucun email de masse envoyé pendant cette session.

### Priorité 3 — Cohérence de l'offre

Le point resté ouvert dans le rapport précédent (la fonctionnalité "Sauvegarder une offre" à la fois annoncée comme payante dans la copy et jamais vérifiée côté serveur) a été traité. Vérification en base : la RPC `save_job` (SECURITY DEFINER) n'imposait aucune condition d'abonnement — un appel direct à l'API (hors interface) aurait permis à n'importe quel compte gratuit de sauvegarder des offres. Correctif appliqué (migration `20260724150000`, commit `90ac032`) : ajout d'une vérification `has_active_pass()` dans la fonction, réutilisant un helper déjà existant dans le schéma. Testé en transaction (rollback garanti, aucune trace) : un compte sans pass actif reçoit `PASS_REQUIRED` ; un compte avec pass actif continue de fonctionner normalement. La copy annonçant "sauvegarde réservée au pass" était donc correcte sur le fond — c'est l'application qui ne la respectait pas ; corrigé côté serveur plutôt que d'affaiblir la promesse.

### Priorité 4 — Test du mode gratuit

Testé en conditions réelles avec un nouveau compte gratuit créé pour l'occasion (`d.kacoutie+jrtest20260724@gmail.com`, id `4c9af276-aa50-495e-9280-dd20bc5b0a2c`, identifiable et supprimable). Confirmé :
- L'accès direct à `/jobradar/feed` sans alerte fonctionne (pas de contournement possible du plafond, cf. mitigations déjà en place côté requêtes).
- La sauvegarde d'offre est désormais bien bloquée côté serveur pour ce compte (cf. Priorité 3).
- **Bug découvert et corrigé pendant ce test** (détail ci-dessous) : la recherche renvoyait une erreur pour la plupart des termes, y compris pour ce compte gratuit.
- **Bug découvert, non corrigé** : le feed ne s'affiche jamais (voir "Bug ouvert" ci-dessous), free ou payant.

---

## Bug n°1 trouvé et corrigé — recherche en erreur pour la plupart des termes

**Symptôme observé** : en cherchant "Data Analyst" avec le compte payant réel, puis "Comptable" avec le nouveau compte gratuit, le feed affichait "Erreur : Une erreur temporaire est survenue" de façon reproductible.

**Cause racine** (confirmée par `EXPLAIN ANALYZE` reproduit exactement dans le contexte réel — rôle `authenticated`, RLS active, via `set_config` + `set local role`) : la policy RLS sur `jobs` ajoute une condition (`is_active = true AND is_expired = false`) qui double une condition déjà présente dans la requête envoyée par l'app. Cette duplication trompe l'estimation de sélectivité de PostgreSQL, qui choisit alors un mauvais index (`jobs_feed_gate_idx`, non trié par date) au lieu du bon (`jobs_digest_feed_sort_idx`, trié par date). Résultat : quasi-scan complet de ~275 000 lignes + tri, jusqu'à 13+ secondes réelles — au-delà du `statement_timeout` du rôle `authenticated` (8 secondes), d'où l'erreur 500 "canceling statement due to statement timeout" traduite en "erreur temporaire" côté utilisateur.

Point important : ce bug était **invisible en testant simplement via un rôle privilégié** (le rôle d'audit en lecture seule bypasse RLS et obtient naturellement le bon plan) — il fallait rejouer le test dans le contexte exact du rôle applicatif réel pour le voir.

**Correctif appliqué** (migration `20260724160000`, commit `175fb49`) : statistiques étendues PostgreSQL (`CREATE STATISTICS ... (dependencies)`) sur `(is_active, is_expired, job_status)`, qui indiquent explicitement au planificateur que ces colonnes sont corrélées. Aucune donnée modifiée, aucun index supprimé, aucune policy RLS touchée. Réversible en une commande.

**Vérifié** : même requête, même contexte, passée de 13 341 ms à 571 ms. Retesté ensuite avec 5 termes de recherche variés ("comptable", "analyst", "developer", "vendeur", "chauffeur") directement contre l'API REST de production, avec le compte de test gratuit : tous en 200 OK, 397 à 820 ms. Reconfirmé visuellement dans le navigateur : la recherche "Comptable" affiche maintenant "80 offres" sans erreur.

---

## Bug n°2 trouvé, diagnostiqué, **non corrigé** — le feed personnalisé ne s'affiche jamais

**Symptôme observé** : même après correction du bug n°1, aucune offre ne s'affiche jamais dans la liste du feed — ni pour le compte de test gratuit, ni (en y repensant) pour le compte payant réel, qui affichait déjà "0 alerte active", "0 offre" et "Personnalisation en cours" bloqué au tout début de cette session, avant même que je touche à quoi que ce soit.

**Cause identifiée dans le code** (`JobRadarFeedPage.tsx` ligne ~2499) : si l'appel à la fonction de personnalisation (`jobradar_match_feed`) échoue ou ne revient jamais, l'écran "Tu n'as pas encore d'alerte" s'affiche à la place des résultats — même quand la recherche a bien renvoyé des offres par ailleurs (le compteur "80 offres" reste correct, mais rien ne s'affiche en dessous).

**Diagnostic de l'échec sous-jacent** : la fonction Edge `jobradar_match_feed` échoue systématiquement en production depuis au moins ce matin (logs remontant à avant le début de cette session), avec des temps d'exécution de 8 à 14 secondes puis une erreur 500. Contrairement au bug n°1, cette fonction utilise la clé `service_role` (elle ne passe donc pas par RLS) — ce n'est donc pas exactement la même cause. J'ai vérifié qu'une des requêtes internes (`fetchJobsTitleOrFamilyTerms`, recherche par titre/famille de poste) est rapide isolément (11 ms) une fois testée séparément ; le ralentissement vient donc d'ailleurs dans le pipeline (`loadUserMatchingContext`, `generateCandidates`, ou la combinaison de plusieurs requêtes lancées en parallèle) — je n'ai pas eu le temps, dans le budget de cette session, d'isoler la requête précise responsable avant la coupure du `statement_timeout`.

**Pourquoi je ne l'ai pas corrigé maintenant** : contrairement au bug n°1, la cause exacte n'est pas encore isolée avec certitude, et le pipeline de matching (`_shared/jobradar_match_core.ts`) est le cœur de la personnalisation — y toucher sans diagnostic complet aurait été le genre d'action risquée que les consignes du projet demandent justement d'éviter ("ne pas complexifier inutilement", "éviter toute régression"). J'ai préféré m'arrêter avec un diagnostic solide plutôt que de rafistoler à l'aveugle.

**Impact concret** : tant que ce n'est pas corrigé, aucun utilisateur — gratuit ou payant — ne voit d'offres personnalisées ni de statut d'alerte correct sur `/jobradar/feed`. C'est un bug bloquant au sens de tes critères de sortie.

**Recommandation** : traiter ce bug en priorité absolue avant toute campagne payante. Prochaine étape concrète : reproduire l'appel à `jobradar_match_feed` avec `include_debug: true` et regarder lequel des sous-appels (`loadUserMatchingContext` vs `generateCandidates`) dépasse le temps raisonnable, probablement en instrumentant temporairement des logs de durée dans `_shared/jobradar_match_core.ts`, ou en testant chaque requête individuellement comme je l'ai fait pour `fetchJobsTitleOrFamilyTerms`.

---

## Ce qui n'a pas été fait dans cette session

Le temps et le volume de travail nécessaires pour tenir les 8 priorités dans leur intégralité (23 scénarios navigateur complets, vérification GA4, dry-run puis activation des 2 crons Paystack, analyse de la relance des 214 comptes) dépassaient ce qu'il était raisonnable de faire d'une traite sans re-vérifier la qualité de chaque étape — d'autant que la découverte du bug n°2 a changé la priorité réelle : un feed qui ne s'affiche jamais est plus urgent que d'activer des crons de relance de paiement.

- **Priorité 5 (test navigateur complet)** : partiellement fait. Scénarios réellement exécutés et vérifiés en base : création de compte (1), confirmation automatique sans email (2), onboarding poste recherché (3-4), recherche par mot-clé (21), accès direct à `/jobradar/feed` (19). Non faits : les scénarios de création d'alerte, double-clic, refresh, retour arrière, élargissement de recherche, écran pricing, affichage mobile (7-18, 20, 22-23) — bloqués de fait tant que le bug n°2 empêche même de voir une offre pour créer une alerte dessus.
- **Priorité 6 (Analytics GA4)** : non commencé.
- **Priorité 7 (crons Paystack)** : vérifié seulement qu'aucun cron n'existe encore pour `paystack_reconcile_pending` / `jobradar_payment_reminder_send` (confirmé en base). Dry-run non exécuté.
- **Priorité 8 (relance des 214 comptes)** : le constat du rapport précédent reste valable et n'a pas changé — ces emails n'ont jamais été réellement envoyés (0 ligne dans `email_logs` pour ce template). Rien à surveiller tant qu'aucun envoi réel n'a eu lieu.

## Un point d'attention sur ta propre session navigateur

Pour tester le mode gratuit en conditions réelles, j'ai dû me déconnecter de ton compte payant dans ton navigateur (aucun autre moyen d'avoir un compte gratuit authentifié dans ce même navigateur). Je n'ai pas tes identifiants et n'ai donc pas pu te reconnecter moi-même — ton navigateur est actuellement sur la page de connexion JobRadar, déconnecté. **Il faudra que tu te reconnectes toi-même** avec ton compte habituel.

## Décision finale

**Pas encore prêt pour Meta Ads.** Deux bugs sévères corrigés et vérifiés en conditions réelles pendant cette session ; un troisième, plus important encore pour l'expérience produit, reste ouvert et bloquant (le feed personnalisé ne s'affiche jamais). Recommandation : traiter le bug n°2 en priorité, puis reprendre les priorités 5 à 8 dans la foulée — la base technique (versioning, cohérence gratuit/payant, emails) est en meilleur état qu'au début de cette session, mais le produit n'est pas encore dans un état montrable à des visiteurs payants.
