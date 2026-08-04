# Rapport — Bug bloquant corrigé + finalisation P5-P7

Date : 26/07/2026
Périmètre : suite directe du rapport du 24/07/2026, qui laissait un bug bloquant ouvert (feed jamais affiché) et les priorités 5 à 7 incomplètes.

**Décision en une phrase : oui, prêt pour Meta Ads.** Le bug bloquant est corrigé et vérifié de bout en bout dans l'interface réelle. Les priorités 5, 6 et 7 sont traitées, avec deux réserves mineures détaillées plus bas (aucune ne bloque le lancement).

---

## Bug bloquant — feed jamais affiché — corrigé

**Cause racine réelle** (différente de ce qui était suspecté le 24/07) : dans `generateCandidates`, la recherche par titre/famille de métier (`title ILIKE ... OR job_family ILIKE ...`) manquait d'index trigram sur `job_family` — seul `title` en avait un. Résultat : Postgres balayait ~372 000 lignes actives à chaque appel (14,6 secondes mesurées), au-delà du timeout de connexion effectif (~8 secondes hérité du rôle `authenticator`), d'où l'échec systématique 500 quel que soit le compte.

Le décalage des crons de santé qui collisionnaient sur les mêmes minutes (migration `20260726110000`, déjà appliquée) était une vraie amélioration mais pas la cause : testé isolément, il ne suffisait pas à corriger le bug.

**Correctif** : ajout de `jobs_job_family_trgm_idx` (index trigram symétrique à celui de `title`), migration `20260726120000`. Vérifié par `EXPLAIN ANALYZE` : 14 645 ms → 264 ms sur la requête exacte. Retesté en conditions réelles via l'edge function : 500/timeout (~10,8 s) → 200 OK (~1,9 s). Confirmé visuellement dans le navigateur : `/jobradar/feed` affiche désormais "30 offres" avec des cartes réelles, pour un compte gratuit fraîchement créé.

Une instrumentation temporaire (`stage_timings_ms`) a été laissée dans `jobradar_match_feed/index.ts` — utile si un ralentissement réapparaît un jour, à retirer quand tu juges que ce n'est plus nécessaire.

## P5 — Test navigateur (complété, hors point mobile)

Scénarios vérifiés en conditions réelles avec le compte de test gratuit :

- **Feed personnalisé** : s'affiche correctement (cf. bug ci-dessus). Recherche par mot-clé ("comptable") : 80 résultats, tri par pertinence, tags "Très pertinent"/"Très adaptée" cohérents.
- **Sauvegarde d'offre (compte gratuit)** : toujours bloquée côté serveur ("Accès requis — un pass actif est requis"), conforme au correctif du 24/07.
- **Double-clic sur "Sauvegarder"** : les deux clics échouent proprement (gating serveur), mais affichent deux toasts identiques au lieu d'un seul — cosmétique, sans risque fonctionnel (aucune écriture en double possible). À corriger un jour si tu veux, pas urgent.
- **Création d'alerte** ("Recevoir ces offres par email") : fonctionne, crée une seule ligne dans `alerts` (vérifié en base). Un second clic avec les mêmes critères affiche "Alerte déjà active" sans doublon — la déduplication de l'Ajustement 1+2 fonctionne.
- **Rafraîchissement de page** : l'état persiste correctement (alerte active, offres, statut) après un F5.
- **Écran tarifs** (`/pricing`) : s'affiche correctement, 4 paliers (Gratuit, Découverte 2,99€/7j, Actif 6,99€/30j "le plus choisi", Avantage 14,99€/90j), toggle EUR/XOF. Je n'ai pas initié de paiement réel (hors périmètre de ce que je peux faire moi-même).
- **Affichage mobile** : non vérifiable dans ce bac à sable — le redimensionnement de fenêtre n'affecte pas le rendu réel capturé ici. À vérifier toi-même sur un vrai téléphone ou via les DevTools si tu veux fermer ce point.

## P6 — Analytics GA4 (vérifié côté code, delivery à confirmer côté toi)

Confirmé dans le navigateur réel : le consentement cookies est respecté (`hasAnalyticsConsent()`), le script `gtag.js` se charge, et les événements partent correctement dans `dataLayer` avec les bons paramètres (`page_view` sur `/jobradar/feed` et `/pricing`, `pricing_viewed`). Le pipeline applicatif fonctionne.

Je n'ai pas pu confirmer la réception réelle côté serveurs Google : Kaspersky (antivirus installé sur cette machine) bloque silencieusement les requêtes vers les domaines de tracking, donc aucune requête `collect` n'apparaît dans le réseau capturé ici, même quand tout le reste fonctionne. **Recommandation** : vérifie toi-même le rapport "Temps réel" de GA4 (propriété `G-EET5B96SX7`) pendant que tu navigues sur le site depuis un autre appareil, pour fermer ce point définitivement.

## P7 — Crons Paystack (dry-run puis activation, fait)

Les deux edge functions (`paystack_reconcile_pending`, `jobradar_payment_reminder_send`) existaient déjà, déployées, mais aucun cron ne les appelait.

**Dry-run** : `candidates_found` / `candidates_fetched` = 0 dans les deux cas, même en poussant la fenêtre jusqu'au plafond dur des fonctions (14 jours). Explication : les seuls paiements Paystack encore `pending`/`ongoing` en base datent du 27/03 et du 10/06/2026 — bien au-delà de ce plafond volontaire ("garde-fou dur même si mal configuré"). Le segment des "214 comptes" mentionné dans les rapports précédents vient d'une table statique différente (`paystack_checkout_recovery_leads`), pas de `billing_payments` — ces crons ne le concernent pas.

**Activation** : migration `20260726130000`, crons actifs :
- `paystack_reconcile_pending_cron` — toutes les 15 min (`:07,:22,:37,:52`)
- `jobradar_payment_reminder_send_cron` — toutes les 30 min (`:17,:47`), volontairement après le reconcile dans le cycle horaire

Premier passage réel du reconcile confirmé en direct (12:52:00 UTC) : 200 OK, 0 effet, comme attendu. Activation donc sans risque immédiat — ces crons ne commenceront à agir que sur de nouveaux paiements laissés en attente après le lancement de la campagne.

## État du dépôt

8 commits locaux sur `dev`, aucun poussé (`ahead 8` — toujours pas d'identifiants git dans ce bac à sable, limitation structurelle inchangée). **Action requise de ta part : `git push origin dev`.** Dans l'ordre :

1. `8363404` — reformulation du titre du feed
2. `c59b8bb` — réduction du volume récupéré pour un compte gratuit
3. `781ae78` — retrait du lien de candidature / description complète pour un compte gratuit
4. `90ac032` — vérification serveur du pass actif dans `save_job`
5. `175fb49` — correctif recherche texte (statistiques étendues)
6. `c46f164` — étalement des crons de santé collisionnés
7. `5d0a09f` — **le correctif du bug bloquant** (index trigram `job_family`)
8. `3dfdd56` — activation des crons Paystack

Toutes les migrations SQL correspondantes sont déjà appliquées en production (nécessaire pour corriger un bug actif immédiatement) — le push ne fait que remettre le dépôt en cohérence avec ce qui tourne déjà.

## Ce qui reste ouvert (mineur, ne bloque pas le lancement)

- Toast dupliqué sur double-clic "Sauvegarder" (cosmétique).
- Affichage mobile non vérifié dans ce bac à sable.
- Confirmation de la réception réelle GA4 côté Google (à vérifier depuis un appareil sans bloqueur de trackers).
