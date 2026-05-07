# Plan V1.5 — Pré-automatisation lifecycle emails JobRadar

## Objectif

La V1.5 prépare l'automatisation du lifecycle email JobRadar sans automatiser l'envoi réel.

L'objectif est d'automatiser uniquement la préparation contrôlée et, plus tard, la mise en queue limitée de candidats éligibles. L'envoi reste volontairement manuel, avec une décision humaine avant chaque email réel.

Aucun cron d'envoi automatique ne doit être activé dans cette phase.

## Ce qui reste manuel

- Vérification DB avant envoi.
- Dry-run worker via `send_marketing_email_queue`.
- Envoi réel uniquement avec `dry_run=false` et `limit=1`.
- Vérification Resend après chaque envoi.
- Vérification des suppressions.
- Mise à jour du registre manuel.
- Décision humaine avant chaque envoi réel.

## Ce qui pourra être automatisé plus tard

- Dry-run périodique des candidats.
- Mise en queue limitée de vrais candidats éligibles.
- Maximum très bas au départ, par exemple 1 à 3 lignes `queued` par jour.
- Aucun envoi automatique.

## Garde-fous obligatoires avant activation d'un cron enqueue

Avant tout cron de mise en queue, les conditions suivantes doivent être vérifiées :

- Aucun `failed` queue.
- Aucun `locked` depuis plus de 15 minutes.
- Aucun `queued` ancien.
- Aucun événement récent `email.bounced`, `email.complained`, `email.suppressed` ou `email.failed`.
- SPF, DKIM et DMARC vérifiés.
- Google Postmaster Tools à préparer avant 20 à 30 vrais emails, avant les envois Gmail réguliers, avant un `limit=5` régulier ou avant tout cron d'envoi.
- Limite quotidienne stricte.
- Arrêt immédiat en cas d'anomalie.

## Proposition de progression

### Phase A

Continuer en manuel jusqu'à environ 10 à 20 envois propres.

### Phase B

Activer seulement un dry-run automatique journalisé.

### Phase C

Activer une mise en queue automatique très limitée, sans envoi.

### Phase D

Envoyer encore manuellement depuis la queue.

### Phase E

Envisager plus tard un cron d'envoi ultra-limité uniquement après signaux stables.

## Règles interdites

- Pas de cron d'envoi maintenant.
- Pas d'envoi automatique maintenant.
- Pas de batch massif.
- Pas de `limit=5` régulier maintenant.
- Pas de cron avant Google Postmaster Tools et vérification SPF, DKIM et DMARC.
