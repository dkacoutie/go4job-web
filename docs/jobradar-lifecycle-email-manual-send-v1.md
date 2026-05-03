# Procédure V1 — Envoi manuel sécurisé des emails lifecycle JobRadar

## Objectif

Cette procédure sert à envoyer très progressivement des emails lifecycle JobRadar, en manuel, avec contrôle humain à chaque étape, sans cron et sans envoi automatique.

Elle encadre uniquement une phase V1 prudente : un dry-run obligatoire avant chaque envoi réel, puis au maximum un email réel par appel.

## Périmètre autorisé

- Envois lifecycle uniquement.
- Envois manuels uniquement.
- Dry-run avant chaque envoi réel.
- Envoi réel uniquement avec `dry_run=false` et `limit=1`.
- Maximum 5 emails réels par jour en semaine 1.
- Espacement d'environ 30 minutes entre deux envois réels.
- Aucun cron.

## Périmètre interdit

- Aucun cron.
- Pas de batch automatique.
- Pas de `limit=5` régulier.
- Pas d'envoi massif.
- Pas d'envoi si SPF/DKIM/DMARC ne sont pas vérifiés avant volume régulier.
- Pas d'envoi si un incident n'a pas été analysé.

## Audit avant envoi

Avant chaque dry-run puis chaque envoi réel, vérifier :

- [ ] `git status` propre.
- [ ] `marketing_email_queue_summary`.
- [ ] Aucun `failed` non analysé.
- [ ] Aucun `locked` bloqué depuis plus de 15 minutes.
- [ ] `email_suppressions`.
- [ ] Derniers `email_logs`.
- [ ] Ligne candidate légitime.
- [ ] Email non interne/test, sauf test volontaire.

## Dry-run obligatoire

Chaque envoi réel doit être précédé d'un dry-run `limit=1`. Si le dry-run retourne une anomalie, ne pas lancer l'envoi réel.

Modèle PowerShell :

```powershell
cd C:\Projets\go4job-web
$secret=((Get-Content 'supabase\functions\.env' | Where-Object { $_ -match '^CRON_SECRET=' }) -replace '^CRON_SECRET=','').Trim()
$body=@{ dry_run=$true; limit=1 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "https://fygsoucyzmfainnbdpvw.supabase.co/functions/v1/send_marketing_email_queue" -Headers @{ "x-cron-secret"=$secret; "Content-Type"="application/json" } -Body $body
```

## Envoi réel limit=1

L'envoi réel V1 est autorisé uniquement avec `dry_run=false` et `limit=1`.

Modèle PowerShell :

```powershell
cd C:\Projets\go4job-web
$secret=((Get-Content 'supabase\functions\.env' | Where-Object { $_ -match '^CRON_SECRET=' }) -replace '^CRON_SECRET=','').Trim()
$body=@{ dry_run=$false; limit=1 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "https://fygsoucyzmfainnbdpvw.supabase.co/functions/v1/send_marketing_email_queue" -Headers @{ "x-cron-secret"=$secret; "Content-Type"="application/json" } -Body $body
```

## Vérification après envoi

Après chaque appel réel, vérifier :

- [ ] Réponse HTTP/function.
- [ ] `marketing_email_queue` : status `sent` ou `skipped` attendu.
- [ ] `email_logs` : `provider_message_id`, `unsubscribe_url` et `status` cohérents.
- [ ] Resend : `Delivered` ou statut correct.
- [ ] `resend_webhook_events` si un événement est reçu.
- [ ] `email_suppressions`.
- [ ] Résultat noté dans le registre manuel.

## Règles d'arrêt immédiat

Arrêter immédiatement les envois si l'un des cas suivants apparaît :

- Erreur Resend.
- Statut `failed`.
- `locked` bloqué depuis plus de 15 minutes.
- Bounce.
- Complaint.
- Suppressed.
- Unsubscribe inattendu.
- Email déjà loggé.
- Anomalie d'idempotence.
- Doute sur la cible.
- Suspicion spam/délivrabilité.
- Réponse function incohérente.

## Registre de suivi manuel

| Date UTC | Heure UTC | Séquence | Step | Email masqué | Dry-run OK | Envoi réel OK | Resend status | Queue status | Email log status | Suppression event | Observations | Décision suivante |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |

## Conditions avant passage ponctuel à limit=5

Un passage ponctuel à `limit=5` ne peut être envisagé qu'après validation humaine explicite et si toutes les conditions suivantes sont remplies :

- Au moins 20 envois réels propres.
- Aucun bounce critique.
- Aucune complaint.
- Unsubscribe normal.
- Aucun `locked` bloqué.
- Aucun `failed` non expliqué.
- `email_logs` cohérents.
- Resend stable.
- Google Postmaster Tools préparé avant usage régulier.
- SPF/DKIM/DMARC vérifiés.
- Validation humaine explicite.

## Google Postmaster Tools

> Rappel :
> Google Postmaster Tools est à préparer avant de dépasser environ 20 à 30 emails réels, avant tout `limit=5` régulier, avant tout cron, ou avant tout envoi régulier vers Gmail.
>
> Ce n'est pas nécessaire pour quelques tests internes `limit=1`.
>
> Vérifier aussi SPF/DKIM/DMARC avant volume régulier.

## Conclusion

La procédure V1 autorise uniquement des envois manuels contrôlés. Le cron reste interdit jusqu'à nouvelle décision.
