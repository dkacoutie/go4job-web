# Audit produit JobRadar / CapCarrière — 24/07/2026

Périmètre : ensemble du produit (hors logique interne de `/jobradar/feed`, déjà corrigée et vérifiée le 23/07). Méthode : lecture de code (27 pages front, ~19 300 lignes), lecture des Edge Functions de paiement, requêtes directes en lecture seule sur Supabase (rôle `claude_readonly_audit` + MCP Supabase en lecture) pour RLS/policies/grants, un passage délégué à un sous-agent pour les pages restantes (profil, CV, alertes, candidatures, onboarding, admin, partenaires, CapCarrière, légal). Aucune modification de code ni de base de données n'a été faite dans cette phase, à l'exception des correctifs déjà validés et livrés le 23/07 sur le feed.

## 1. Inventaire

27 pages dans `src/`, routées dans `App.tsx` sous trois familles : public (landing, pricing, cv-ats, contact, légal), authentifié (`/`, profil, CV, alertes, candidatures, offres, abonnement, onboarding), admin/partenaires (santé, sources, partenaires admin, portail partenaire, CapCarrière admin). Environ 40 Edge Functions Deno côté Supabase. Un seul environnement Supabase (`fygsoucyzmfainnbdpvw`, eu-north-1), pas de staging.

## 2. Méthode

Lecture complète des fichiers de moins de 300 lignes, lecture ciblée (grep + sections clés) pour les fichiers plus longs (`AdminPartnersPage.tsx`, `AlertsPage.tsx`, `MyCvPage.tsx`). Pour chaque page authentifiée ou admin : vérification du filtre `user_id` côté client, puis vérification indépendante des policies RLS réelles en base (pas seulement du code client) pour les tables sensibles — paiements, abonnements, comptes partenaires, commissions, paiements aux partenaires. C'est cette dernière étape qui a le plus de valeur : une page peut sembler sûre côté code et être exposée si la RLS sous-jacente est absente ou mal scopée.

## 3. Évaluation générale, honnête

Le code est globalement propre et cohérent : pas de `console.log` ni de `TODO`/`FIXME` qui traînent (grep sur tout `src/`), pas de catch vide silencieux identifié, gestion d'erreurs homogène (message générique + log technique côté navigateur), formulaires avec honeypot anti-spam, RLS activée et correctement scopée sur toutes les tables métier sensibles que j'ai vérifiées (paiements, abonnements, comptes et commissions partenaires). Le paiement Paystack (initialisation + webhook) est bien architecturé : vérification de signature HMAC-SHA512 en temps constant, idempotence, garde anti-double-activation, conversion correcte des montants en unité mineure XOF.

Le point faible n'est pas la qualité du code mais deux choses : un doute sérieux et non résolu sur la clé Paystack réellement utilisée en production (point 8, prioritaire), et une accumulation de petits frottements produit/UX qui, mis bout à bout sur le tunnel d'inscription → paiement, peuvent expliquer une bonne partie de l'absence de ventes indépendamment de la performance technique déjà corrigée.

## 4. Problèmes par priorité

**P0 — bloque ou risque de bloquer directement la vente**

- Clé publique Paystack `pk_test_...` trouvée dans le bundle JS actuellement servi par `go4job.org` (fetch direct de l'origine Netlify, en-têtes `server: Netlify` confirmés, cache désactivé). Si c'est bien la clé actuellement en production, cela signifie que tout paiement réel passe en mode test Paystack : un client avec une vraie carte ne peut pas payer. C'est la explication la plus directe possible à « zéro vente en un an ». **Réserve importante** : mon environnement de test a servi de façon persistante le même bundle tout au long de cette session, y compris après plusieurs redéploiements confirmés par vous sur Netlify — je n'ai pas pu établir avec certitude si ce que j'ai lu reflète l'état réel actuel ou un artefact de mon propre sandbox. Je n'affirme donc pas que c'est le cas, je dis que c'est l'hypothèse la plus dangereuse et la plus facile à vérifier. Voir point 8.

**P1 — bugs confirmés, à corriger avant toute campagne**

- `AuthPage.tsx` : une inscription avec un email déjà utilisé renvoie le même message générique « erreur temporaire » que n'importe quelle autre erreur. L'utilisateur ne sait pas qu'il doit se connecter au lieu de s'inscrire — perte silencieuse de prospects à l'endroit le plus sensible du tunnel.
- `JobDetailsPage.tsx` : le HTML des descriptions de poste (issu de sources scrapées externes non fiables) est affiché via `dangerouslySetInnerHTML` après passage dans un sanitizer HTML maison (`sanitizeHtmlBasic`), et non une librairie éprouvée type DOMPurify. Le sanitizer maison retire scripts/iframes/attributs `on*`/`javascript:`, mais ne couvre pas tous les vecteurs connus (`style` avec expressions, `srcdoc`, SVG/MathML, `<base>`, entités encodées). Risque XSS résiduel si une source de scraping est compromise ou manipulée.

**P2 — frictions produit/UX réelles, à traiter avant la prochaine vague d'acquisition**

- `LandingPage.tsx` : aucun aperçu d'offre avant inscription, toute recherche redirige vers `/auth`. Le visiteur doit créer un compte avant de voir la moindre preuve de valeur — friction classique en haut de tunnel.
- `HomePage.tsx` : `loadAll()` enchaîne séquentiellement profil, candidatures, alertes, puis l'appel `cv_save`, au lieu de paralléliser comme le fait `PricingPage`. Ralentit la première page vue après connexion sans raison technique.
- `AlertsPage.tsx` : vérification puis création de l'alerte en deux requêtes séparées (pas atomique) pour la limite du plan gratuit — un double-clic ou deux onglets peuvent dépasser la limite. Impact business mineur, pas une faille de sécurité.
- Mot de passe minimum à 6 caractères sur `AuthPage.tsx` — faible au regard des standards actuels, sans être une urgence.

**P3 — dette / cohérence, sans urgence**

- Deux tables `plans` et `subscriptions` (sans préfixe `billing_`) existent en base, sans RLS, mais sans le moindre droit accordé à `anon`/`authenticated` — donc non exploitables via l'API, probablement des tables mortes issues d'une itération antérieure au schéma `billing_*` actuel. À nettoyer ou documenter pour éviter la confusion avec les vraies tables de facturation.
- Table `v_secret` (colonne unique `value`), sans RLS mais sans droit client non plus — non exploitable via l'API publique, mais son nom et son existence méritent une vérification manuelle de ce qu'elle contient réellement.

## 5. Ce qui fonctionne bien, sans besoin d'y toucher

`HomePage.tsx` (liste "Commencer ici" bien pensée, divulgation progressive claire), `PricingPage.tsx` (chargement parallélisé, garde-fous anti double paiement, transparence sur l'affichage EUR vs facturation réelle en XOF), `ProfilePage.tsx`, `ApplicationsPage.tsx`, `ContactPage.tsx`, les Edge Functions `paystack_initialize` et `paystack_webhook`, la gestion admin (`AdminHealthPage`, `admin_capcarriere_draft_review`) qui revérifie systématiquement le statut admin côté serveur et pas seulement côté client.

## 6. Bugs confirmés (résumé)

Message d'erreur d'inscription non différencié (P1), sanitizer HTML maison insuffisant sur les descriptions de poste (P1), chargement séquentiel non justifié sur `HomePage` (P2), race condition non atomique sur la limite d'alertes gratuites (P2).

## 7. Performance et fiabilité

Le chantier du 23/07 a traité la cause racine du ralentissement du feed (cron de maintenance non indexés + filtre de recherche forcé par le rôle du profil). Aucune régression identifiée ailleurs : les autres pages n'appellent pas la logique de recherche du feed, et le pattern de chargement différé (`scheduleDeferredFeedTask`) reste local à `JobRadarFeedPage.tsx`. Le seul autre point de performance identifié est le chargement séquentiel de `HomePage.tsx` — mineur en comparaison, mais gratuit à corriger (même pattern `Promise.all` que `PricingPage`).

## 8. Sécurité (le point le plus important à traiter en premier)

Vérification systématique des policies RLS réelles en base (pas seulement du code client) sur les tables sensibles :

- `billing_payments`, `billing_subscriptions` : RLS activée, policy `auth.uid() = user_id`, correcte.
- `partner_accounts`, `partner_commissions`, `partner_conversions`, `partner_payouts` : RLS activée, policy `own partner OR is_internal_admin()`, correcte.
- Les vues `admin_partner_summary` et `partner_dashboard_summary` sont déclarées `security_invoker=true` : elles appliquent donc bien les policies RLS de l'utilisateur qui interroge, et non celles du propriétaire (`postgres`). C'est le point que j'ai vérifié en priorité car une vue sans `security_invoker` sur des tables sensibles est une fuite de données classique — ici, ce n'est pas le cas.
- 5 fonctions `SECURITY DEFINER` sans garde interne (`has_active_pass`, `jobradar_monitor_sources`, `jobradar_source_health_maintenance`, `jobradar_reactivate_min_sources`, `jobradar_monitor_alert_email`) étaient exécutables par n'importe quel appelant anonyme via l'API REST. Un correctif (`20260723090000_revoke_public_exec_maintenance_and_pass_rpcs.sql`) a déjà été écrit et documenté lors de la session précédente mais **n'a pas encore été exécuté en base** — il attend votre validation dans le SQL Editor, comme les autres migrations de ce projet.

**Action prioritaire absolue avant toute nouvelle campagne** : vérifier directement dans Netlify (Site settings → Environment variables) la valeur de `VITE_PAYSTACK_PUBLIC_KEY`, et dans Supabase (Edge Functions → Secrets) la valeur de `PAYSTACK_SECRET_KEY`. Si les deux commencent par `pk_live_`/`sk_live_`, le point P0 ci-dessus est écarté. Si l'une des deux est en `_test_`, aucun client ne peut payer avec une vraie carte tant que ce n'est pas corrigé — c'est la vérification la plus importante de tout cet audit.

## 9. UX / mobile

Passage léger (recherche de media queries CSS, pas de test visuel réel) : les pages utilisateur (`ProfilePage`, `AlertsPage`, `ApplicationsPage`) ont un nombre de media queries cohérent. `MyCvPage.css` n'en a que 4 pour une page dense (édition CV + aperçu) — à vérifier visuellement sur mobile, c'est le candidat le plus probable à un rendu cassé sur petit écran. Les pages admin (`AdminSourcesPage`, `AdminPartnersPage`) sont assumées desktop-only, ce qui est raisonnable pour un outil interne.

## 10. Incohérences entre pages

Pattern de chargement des données non uniforme : `PricingPage`, `SubscriptionPage`, `PartnerPortalPage`, `BecomePartnerPage` et `JobRadarOnboardingPage` parallélisent correctement via `Promise.all` ; `HomePage` ne le fait pas alors qu'elle a le même besoin. Rien de grave, mais à harmoniser pour la cohérence du code et un léger gain de vitesse perçue sur la première page vue après connexion.

## 11. Friction à la conversion / paiement

Le tunnel de paiement lui-même (`PricingPage` → `paystack_initialize` → Paystack hosted checkout → `paystack_webhook`) est solide : reprise d'un paiement en attente au lieu d'en recréer un nouveau, garde anti double-activation, message clair sur la devise de facturation réelle. La friction la plus probable n'est pas dans ce tunnel mais en amont : pas d'aperçu d'offres avant inscription (point 4/P2) et message d'erreur d'inscription non différencié (point 4/P1) — deux endroits où un visiteur intéressé peut abandonner avant même d'arriver à la page de prix.

## 12. Dette technique

Fonctions `SECURITY DEFINER` créées hors migration versionnée (point 8, en cours de correction), tables `plans`/`subscriptions` mortes à côté du schéma `billing_*` actif, sanitizer HTML maison à remplacer par une librairie dédiée, pattern de chargement de données à harmoniser.

## 13. Éléments esthétiques uniquement

Rien identifié qui mérite d'être séparé ici — les observations de ce rapport sont toutes fonctionnelles ou liées à la sécurité/performance, pas purement visuelles.

## 14. Options de correction, quand plusieurs existent

- Message d'erreur d'inscription : soit détecter spécifiquement le code d'erreur Supabase "email déjà utilisé" et afficher un message dédié avec lien vers la connexion (correction ciblée, peu de risque), soit revoir plus largement la cartographie erreurs Supabase → messages FR (comme déjà fait sur `ContactPage` avec `mapContactError`) pour toute l'app — plus de travail mais réutilisable.
- Sanitizer HTML : remplacer `sanitizeHtmlBasic` par DOMPurify (bibliothèque légère, largement éprouvée) est la correction la plus sûre et la plus rapide plutôt que d'étendre la liste noire maison indéfiniment.

## 15. Recommandations personnelles

Traiter le point 8 (clé Paystack) avant toute autre chose : c'est la seule hypothèse de cet audit qui explique à elle seule un an sans vente. Ensuite, corriger le message d'erreur d'inscription et le sanitizer HTML (les deux P1) — travail de quelques heures, risque de régression faible. Le reste (P2/P3) peut suivre sans urgence.

## 16. Plan d'action priorisé

1. **Vérifier la clé Paystack en production** (Netlify + Supabase Secrets). Aucune dépendance technique, aucun risque de régression — c'est une lecture de configuration. Critère de validation : les deux clés (publique et secrète) commencent par le préfixe `live`. Si ce n'est pas le cas, basculer les deux vers les clés live et refaire un paiement réel de test avant toute campagne.
2. **Exécuter la migration de sécurité déjà écrite** (`20260723090000_revoke_public_exec_maintenance_and_pass_rpcs.sql`), déjà documentée et prête, dans le SQL Editor. Aucun risque : elle retire un accès public qui n'est utilisé par aucun code legitime (vérifié par grep). Critère de validation : `select routine_name, grantee from information_schema.routine_privileges where routine_name in (...) and grantee in ('anon','authenticated')` ne retourne plus rien pour ces 5 fonctions.
3. **Message d'erreur d'inscription différencié.** Dépendance : aucune. Risque de régression : faible, isolé à `AuthPage.tsx`. Critère de validation : tester une inscription avec un email déjà existant, vérifier le message affiché et qu'un login normal fonctionne toujours.
4. **Remplacer le sanitizer HTML maison par DOMPurify** sur `JobDetailsPage.tsx`. Dépendance : ajout d'une librairie (`npm install dompurify`). Risque : faible mais à tester sur plusieurs offres réelles avec descriptions riches (tableaux, liens, listes) pour vérifier qu'aucun rendu légitime n'est cassé. Critère de validation : les descriptions de poste existantes s'affichent identiquement, et un contenu de test contenant un vecteur XSS connu (`<img src=x onerror=alert(1)>`, `<svg onload=...>`) est bien neutralisé.
5. **Paralléliser le chargement de `HomePage.tsx`** avec `Promise.all`, même pattern que `PricingPage`. Risque quasi nul, gain de vitesse perçue.
6. **Nettoyer ou documenter les tables `plans`/`subscriptions` mortes** et vérifier le contenu de `v_secret`. Non urgent, non exploitable en l'état.

## 17. Ordre d'exécution proposé

1 et 2 en premier (configuration/sécurité, zéro risque de régression produit). Puis 3 et 4 ensemble (même zone fonctionnelle, tunnel d'inscription et affichage d'offre — les deux endroits les plus visibles par un nouvel utilisateur). Puis 5 et 6 en fond de tâche, sans urgence.

## 18. Liste explicite des choses à ne pas toucher

La logique de chargement du feed (`JobRadarFeedPage.tsx`) déjà corrigée et validée le 23/07 — ne pas la retoucher sans nouvelle mesure de régression. Les index créés le 23/07 (`idx_jobs_created_at`, `idx_jobs_last_seen_at`, `idx_jobs_published_at_plain`, `idx_jobs_desc_updated_at`, `idx_jobs_is_expired_true`, `idx_jobs_active_feed_covering`) et le cron `admin-health` réglé à 15 minutes. Les fonctions `admin_grant_admin_access` et `activate_pass_from_payment`, qui ont leurs propres gardes internes et ne doivent pas être incluses dans la migration de revoke du point 8. La fonction `jobradar_job_lifecycle_maintenance()`, volontairement laissée hors du chantier du 23/07 car elle fait de vraies écritures sur le cycle de vie des offres — à auditer séparément si besoin, pas en même temps qu'un autre chantier.

## 19. Conclusion honnête

JobRadar est techniquement plus solide que ce que la réputation d'un produit sans aucune vente en un an pourrait laisser penser. Le code est propre, la sécurité des données sensibles (paiements, comptes partenaires) est correctement mise en œuvre au niveau base de données — ce qui est le point le plus difficile à obtenir et le plus souvent négligé. Le vrai risque n'est pas dans dix bugs dispersés, il est concentré sur une seule question non résolue : est-ce que les paiements réels fonctionnent en ce moment. Techniquement, oui, le produit est assez solide pour vendre aujourd'hui, à condition que le point 8 soit vérifié et, si besoin, corrigé en premier.

Les difficultés restantes sont mixtes, mais pas également réparties : probablement plus produit/acquisition que technique une fois le point Paystack traité. Rien dans ce que j'ai lu ne suggère un problème d'infrastructure qui empêcherait structurellement de vendre — le ralentissement du feed, qui était le symptôme le plus visible, est déjà réglé et mesuré.

Les 3 actions à plus fort impact sur les chances de vente maintenant : vérifier et, si besoin, corriger les clés Paystack (sans ça, rien d'autre ne compte) ; corriger le message d'erreur d'inscription (premier point de friction qu'un visiteur rencontre) ; ajouter un aperçu d'offres avant inscription sur la landing page (donner une raison concrète de créer un compte plutôt qu'un mur d'inscription immédiat).

Ce qui doit être terminé avant toute nouvelle campagne d'acquisition : les points 1 à 4 du plan d'action (clés Paystack, migration de sécurité, message d'inscription, sanitizer HTML). Ce qui peut attendre après les premières ventes : l'harmonisation des patterns de chargement, le nettoyage des tables mortes, et tout ce qui est classé P2/P3 dans ce rapport.
