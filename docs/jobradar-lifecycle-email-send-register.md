# Registre manuel — Envois lifecycle JobRadar

## Objectif

Ce fichier sert à suivre manuellement chaque dry-run et chaque envoi réel lifecycle JobRadar pendant la phase V1.

## Règles d'utilisation

- Une ligne doit être ajoutée après chaque dry-run significatif.
- Une ligne doit être ajoutée après chaque envoi réel.
- Ne jamais envoyer un email réel sans dry-run juste avant.
- Pour la semaine 1 : maximum 5 emails réels par jour.
- Les envois réels doivent rester en `dry_run=false` et `limit=1`.
- Espacer les envois réels d'environ 30 minutes.
- Aucun cron.
- En cas d'anomalie, arrêter les envois et noter l'incident.

## Tableau principal

| Date UTC | Heure UTC | Type action | Séquence | Step | Email masqué | Dry-run OK | Envoi réel OK | Resend status | Queue status | Email log status | Suppression event | Anomalie | Observations | Décision suivante |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-05-03 | 12:56 | envoi réel test interne | lifecycle_test_manual_20260503 | email_1 | inf***@gmail.com | oui | oui | Delivered côté Resend / log ensuite unsubscribed après clic test | sent | unsubscribed | unsubscribed test, puis suppression interne nettoyée | non | test interne volontaire vers infos.go4job@gmail.com ; email reçu ; lien de désinscription testé ; ne pas copier l'unsubscribe_url ni le token dans le registre | registre initialisé ; continuer uniquement en manuel avec dry-run obligatoire et limit=1 |
| 2026-05-03 | 14:24 | envoi réel utilisateur contrôlé | payment_attempt_no_success | email_1 | smi***@gmail.com | oui | oui | Delivered | sent | sent | aucun | non | premier envoi réel utilisateur contrôlé ; dry-run worker OK juste avant ; Resend Delivered ; provider_message_id présent en DB ; lien de désinscription présent mais ne pas copier l'URL ni le token | attendre au moins environ 30 minutes avant tout autre envoi réel ; continuer uniquement en manuel avec dry-run obligatoire et limit=1 |
| 2026-05-03 | 15:11 | envoi réel utilisateur contrôlé | interested_no_payment_attempt | email_1 | nog***@gmail.com | oui | oui | Delivered | sent | sent | aucun | non | deuxième envoi réel utilisateur contrôlé ; dry-run strict OK avec sequence_key, segment_key et template_key explicites ; dry-run worker OK juste avant ; Resend Delivered ; provider_message_id présent en DB ; lien de désinscription présent mais ne pas copier l'URL ni le token | envoi du 03/05 enregistré ; avant tout nouvel envoi réel, refaire l'audit complet, dry-run obligatoire et limit=1 ; aucun cron |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |

## Rappels avant montée en volume

- Ne pas dépasser environ 20 à 30 emails réels sans préparer Google Postmaster Tools.
- Vérifier SPF/DKIM/DMARC avant volume régulier.
- Ne pas passer à `limit=5` régulier sans validation humaine explicite.
- Ne pas activer de cron à ce stade.
