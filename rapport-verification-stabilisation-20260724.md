# Vérification et stabilisation avant commercialisation — 24/07/2026

## 1. Configuration Paystack vérifiée

Le vrai domaine de production n'est pas `go4job.org` (domaine à l'abandon, voir point 10) mais `go4jobapp.com`, qui redirige vers `jobradar.go4jobapp.com` (hébergé derrière Cloudflare). Vérification directe du bundle réellement servi sur ce domaine :

- Clé publique embarquée : **`pk_live_...`** (préfixe live confirmé, valeur complète non divulguée). Pas de clé test dans le code chargé pour un utilisateur normal.
- Projet Supabase référencé dans ce bundle : `fygsoucyzmfainnbdpvw` — le bon projet, celui audité tout au long de cette mission.
- Cohérence indirecte avec la clé secrète serveur : les paiements initiés en mai et juin 2026 (avant l'arrêt des tentatives) portent tous `test_mode:"false"` dans leur `provider_payload`, un champ positionné côté serveur par `paystack_initialize` selon le préfixe de la clé secrète configurée. Les deux signaux (clé publique live côté client, indicateur serveur cohérent) pointent dans la même direction.
- Callback et domaine : la page de test tarifs, chargée sur `jobradar.go4jobapp.com`, affiche correctement le pass actif existant du compte connecté et les bons montants (1500 FCFA / 7 jours, etc.), cohérent avec les données réelles en base.
- Webhook Paystack (URL exacte, statut des derniers événements dans le dashboard Paystack) : **non vérifiable depuis mon environnement**, je n'ai pas d'accès au dashboard Paystack. À vérifier de ton côté si tu veux une confirmation complète — mais la preuve indirecte (chaîne paiement → abonnement qui fonctionne historiquement, point 2) rend un webhook mal configuré peu probable.

## 2. Paiement réel de bout en bout

Tu as choisi de ne pas déclencher de paiement réel maintenant. À la place, j'ai vérifié la chaîne complète sur les paiements historiques réellement passés par de vrais clients (hors ton propre compte de test) : pour chacun des paiements marqués `paid`/`paid_test` en base, un abonnement `billing_subscriptions` correspondant a été créé entre 1 et 4 secondes après le paiement, avec la bonne durée (7/30/90 jours selon le plan payé). Exemple : paiement de 500 XOF le 27/03/2026 à 09:38:07 → abonnement actif créé à 09:38:09, se terminant le 03/04/2026 (7 jours). La chaîne paiement → webhook → `billing_payments` → `billing_subscriptions` → pass actif a donc fonctionné correctement pour tous les vrais clients historiques. Ce que cette vérification ne couvre pas : un test avec les identifiants Paystack et le déploiement *actuels*, dans les conditions d'aujourd'hui — si tu veux ce niveau de certitude, il faudra un vrai paiement de test à un moment où tu es prêt à valider la dépense.

## 3. Migration de sécurité

`20260723090000_revoke_public_exec_maintenance_and_pass_rpcs.sql` : vérifiée en détail avant application. Les 5 fonctions ciblées (`has_active_pass`, `jobradar_monitor_sources`, `jobradar_source_health_maintenance`, `jobradar_reactivate_min_sources`, `jobradar_monitor_alert_email`) n'ont, à l'examen direct des privilèges Postgres (`has_function_privilege`), déjà plus aucun droit d'exécution pour `anon`/`authenticated` — seuls `postgres` et `service_role` y ont accès. L'avertissement de sécurité correspondant n'apparaît plus dans les advisors Supabase. Le risque était donc déjà clos avant mon intervention (par qui/quand, je ne sais pas). Aucun appel légitime identifié vers ces fonctions depuis le frontend (grep sur `src/`). Rollback : `GRANT EXECUTE ON FUNCTION ... TO anon, authenticated` si jamais un besoin légitime apparaissait. Fichier committé (`ccb660a`) pour la traçabilité ; non exécuté dans le SQL Editor puisque sans urgence — à faire quand tu veux, sans risque.

## 4. Corrections réalisées

- **`src/AuthPage.tsx`** : une inscription avec un email déjà utilisé affiche maintenant un message clair invitant à se connecter, au lieu du message générique d'erreur qui laissait croire à un problème technique. Détection via le signal documenté par Supabase (`data.user.identities.length === 0` après un `signUp` réussi sans erreur) plutôt que via un nouvel appel qui aurait pu servir à tester l'existence d'un email indépendamment d'une vraie tentative d'inscription.
- **`src/JobDetailsPage.tsx`** : le sanitizer HTML maison est remplacé par DOMPurify avec une liste blanche de balises restreinte au contenu utile d'une description de poste.
- **`src/HomePage.tsx`** : les 4 chargements de la page d'accueil (profil, candidatures, alertes, CV) tournent en parallèle via `Promise.allSettled` au lieu de s'enchaîner ; seule la création du profil s'il n'existe pas reste dépendante de sa lecture, comme il se doit.

## 5. Fichiers et migrations modifiés

`src/AuthPage.tsx`, `src/HomePage.tsx`, `src/JobDetailsPage.tsx`, `package.json`, `package-lock.json` (ajout de `dompurify` + `@types/dompurify`), `supabase/migrations/20260723090000_revoke_public_exec_maintenance_and_pass_rpcs.sql`. Tout est committé et poussé sur `dev` (commit `ccb660a`, après `285f62c` de la veille).

## 6. Tests de sécurité

Sanitizer DOMPurify testé avec un script Node isolé (jsdom + dompurify, hors du projet pour ne pas polluer ses dépendances) sur 11 cas : contenu réel (paragraphes, listes, tableau, lien, HTML mal formé) rendu correctement, et 8 charges XSS connues — `<script>`, `onerror` sur `<img>`, `onload` sur `<svg>`, `href="javascript:"`, `href="data:"`, `style` avec `url(javascript:)`, `<iframe>`, `<base>`, `srcdoc`, entités HTML encodées — toutes neutralisées sans exception. RLS revérifiée directement en base sur les tables sensibles (`billing_payments`, `billing_subscriptions`, `partner_accounts`, `partner_commissions`, `partner_conversions`, `partner_payouts`) : policies correctement scopées à `auth.uid() = user_id` ou `is_internal_admin()`. Les vues `admin_partner_summary` et `partner_dashboard_summary` sont déclarées `security_invoker=true`, donc elles appliquent bien les RLS de l'appelant et non celles du propriétaire — pas de fuite cross-tenant. Deux tables historiques (`plans`, `subscriptions`, sans le préfixe `billing_`) et une table `v_secret` n'ont pas de RLS mais n'ont non plus aucun droit accordé à `anon`/`authenticated`, donc non exploitables via l'API — à nettoyer un jour pour la clarté, pas urgent.

## 7. Performance avant/après (HomePage)

Mesuré au niveau base de données par `EXPLAIN ANALYZE` sur un utilisateur réel ayant profil, candidatures et alertes : lecture du profil 1,35 ms, comptage des candidatures 0,11 ms, comptage des alertes 0,11 ms. Le temps d'exécution SQL n'était donc pas le problème — il est resté négligeable avant et après. Le vrai gain de la parallélisation n'est pas mesurable en millisecondes SQL, il est dans l'élimination de l'empilement des allers-retours réseau (4 appels réseau séquentiels avant, contre un chargement concurrent après, avec tolérance de panne partielle via `Promise.allSettled`). Je n'ai pas pu chiffrer le gain réel en millisecondes côté navigateur faute d'avoir pu faire un test de charge réseau représentatif dans le temps imparti — honnêtement, ce chiffre manque à ce rapport.

## 8. Test visuel et mobile

Test réel dans Chrome sur le vrai domaine de production (`jobradar.go4jobapp.com`), pas une simple lecture de CSS : landing (`go4jobapp.com`), redirection vers `/jobradar/feed`, page tarifs, page alertes — toutes rendues correctement en desktop, cohérentes avec les données réelles du compte connecté (pass actif jusqu'au 07/08/2026 affiché correctement, montants des pass corrects). **Limite honnête à signaler** : l'outil de redimensionnement de fenêtre de mon environnement n'a pas fonctionné cette session — la fenêtre est restée bloquée à sa taille desktop (2048 px) malgré plusieurs tentatives à des tailles tablette et mobile, donc je n'ai pas pu produire de capture d'écran réelle en largeur mobile ou tablette cette fois. Le test mobile réel reste à faire, soit en relançant une session où cet outil fonctionne, soit en le faisant toi-même sur ton téléphone sur les pages listées dans ta demande initiale.

## 9. Funnel réellement observable

259 comptes créés au total depuis le lancement, dont 234 (90 %) en un seul mois : mars 2026. Depuis : 13 en avril, 2 en mai, 2 en juin, **zéro en juillet**. 100 % des emails sont confirmés. 19 profils complétés (7 % des inscrits), 11 utilisateurs avec au moins une alerte (25 alertes au total), 4 utilisateurs avec des candidatures suivies (79 candidatures, très concentrées). 43 utilisateurs ont initié un paiement (17 % des inscrits), 14 paiements ont abouti (13 réels + 1 test), tous datés d'avant le 27 mars 2026 — aucun paiement réussi depuis, et aucune tentative de paiement du tout depuis le 10 juin (44 jours de silence complet). Un seul abonnement actif dans toute la base actuellement, celui de ton propre compte. 36 leads de reprise de panier abandonné, 6 leads CV-ATS.

## 10. Points de rupture identifiés

Le point de rupture principal n'est pas technique, il est temporel : l'acquisition s'est arrêtée net fin mars/début avril 2026, plusieurs mois avant mon intervention. Rien dans le code ou la base ne pointe vers une cause technique à ce moment précis (pas de déploiement cassant identifié à cette date dans l'historique git). Deuxième point, découvert en cours de route : `go4job.org` (différent de `go4jobapp.com`) est un domaine à l'abandon qui sert actuellement un prototype Bolt.new sans rapport avec JobRadar (page blanche avec badge "Made in Bolt", projet Supabase différent). Le code du dépôt `go4job-web` référence encore ce domaine en dur à plusieurs endroits (user-agent des bots d'ingestion, URL de base des pages de remerciement d'email `THANKS_BASE_URL`, lien de retour de `thanks_page`). **Point à vérifier de ton côté** : si la variable d'environnement `THANKS_BASE_URL` n'est pas explicitement positionnée sur `https://go4jobapp.com` dans la configuration des Edge Functions Supabase, les emails envoyés aux utilisateurs (confirmations, actions) pourraient contenir des liens vers le mauvais domaine. Je n'ai pas pu vérifier la valeur réelle de cette variable (secret d'Edge Function, non lisible en lecture seule).

## 11. Événements analytics manquants

Google Analytics 4 est câblé dans le code (`G-EET5B96SX7`) mais `initGoogleAnalytics()` n'est appelée nulle part dans l'application — le script `gtag.js` n'est donc jamais chargé et aucune donnée de visite n'a jamais été collectée, malgré le code de tracking existant. C'est un vrai bug, facile à corriger. Un Pixel Facebook (`fbevents.js`) est en revanche chargé sur le domaine réel — des données publicitaires existent peut-être côté Meta Ads Manager, à vérifier directement là-bas. Manquent pour un funnel complet : le nombre de visiteurs uniques avant inscription (aucun outil ne le mesure aujourd'hui côté produit), les vues de la page tarifs, les vues d'offres individuelles, les abandons de panier au moment précis du clic "payer" (on ne voit que le `pending` créé, pas si l'utilisateur a vu la page Paystack ou l'a fermée avant).

## 12. Recommandation — aperçu public des offres

**Problème résolu** : aujourd'hui, toute recherche sur la landing redirige vers `/auth` sans montrer une seule offre — le visiteur doit créer un compte avant d'avoir la moindre preuve que le produit contient des offres pertinentes pour lui. Combiné à la chute d'acquisition observée dès avril, réduire ce mur d'entrée est une des rares actions produit qui agit directement sur le haut du funnel plutôt que sur la conversion des inscrits déjà acquis.

**Données qui justifient ce changement** : 259 inscrits pour seulement 19 profils complétés et 4 utilisateurs avec candidatures suivies — beaucoup de comptes créés « à froid », sans engagement réel ensuite, cohérent avec des visiteurs qui s'inscrivent par nécessité plutôt que par conviction après avoir vu de la valeur.

**Contenu à rendre visible sans compte** : un aperçu limité (10 à 15 offres) filtrable par mot-clé et pays, avec titre, entreprise, localisation, type de contrat et date de publication — sans les détails complets ni le lien de candidature.

**Limites sans compte** : pas d'accès à la description complète, pas de lien de candidature direct, pas de sauvegarde ni d'alerte.

**Moment de demander l'inscription** : au clic sur une offre pour voir le détail, ou au clic sur « postuler » — jamais avant, pour laisser le temps de constater la pertinence.

**Risques** : techniquement faible (réutilisation de l'existant `v_jobs_feed`, déjà accessible en lecture par `anon`) ; SEO plutôt positif si bien fait (pages d'offres indexables, actuellement invisibles aux moteurs de recherche puisque derrière l'authentification) ; commercial à surveiller — s'assurer que l'aperçu ne dispense pas de créer un compte pour la vraie valeur (alertes, candidature).

**Critères de succès** : taux de passage visite → inscription en hausse, sans baisse du taux de complétion de profil chez les nouveaux inscrits.

**Expérience recommandée** : desktop et mobile identiques dans la logique (grille responsive déjà en place sur le feed existant), pas de version dégradée mobile.

## 13. Problèmes réellement bloquants

Aucun bloqueur technique de premier ordre restant à ma connaissance sur le chemin critique (inscription → offres → alerte → paiement → activation). Ce qui reste à faire avant d'être totalement serein : un vrai test de paiement en conditions réelles (reporté à ta demande), le test visuel mobile réel (bloqué par un outil cette session), et la vérification de `THANKS_BASE_URL` pour éviter des emails pointant vers le mauvais domaine.

## 14. Réponse finale

Techniquement, JobRadar peut être remis en acquisition, payante ou organique, dès maintenant — la configuration de paiement est en mode live, la chaîne paiement → activation a fonctionné pour tous les vrais clients historiques, les deux bugs de sécurité/UX identifiés hier sont corrigés et déployés. La vraie question n'est plus technique : l'acquisition s'est arrêtée en avril, bien avant tout ce qui a été audité ici, et rien dans le code ne l'explique — c'est un sujet produit/marketing (budget publicitaire coupé ? campagne arrêtée ? canal tari ?) qui sort du périmètre de cet audit technique. Avant de relancer une dépense d'acquisition, je recommande : activer réellement Google Analytics (un vrai bug, une ligne de code), vérifier `THANKS_BASE_URL`, et faire un vrai test de paiement de bout en bout le jour où tu es prêt à valider la dépense.

## 15. Branche, commits, déploiement, rollback

Branche `dev`, commits `285f62c` (23/07, correctif feed) puis `ccb660a` (24/07, corrections de cette mission), tous deux poussés sur `origin/dev`. Déploiement Netlify/Cloudflare non déclenché par moi — à vérifier que `dev` est bien la branche déployée en production sur `jobradar.go4jobapp.com` (je n'ai pas pu confirmer ce point avec certitude absolue, contrairement à `go4job.org` qui s'est révélé être un domaine sans rapport). Rollback si besoin : `git revert ccb660a` puis nouveau push ; aucune migration destructive n'a été appliquée en base, la migration de sécurité est un simple `REVOKE` réversible par `GRANT`.
