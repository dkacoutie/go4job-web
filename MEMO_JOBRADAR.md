Memo - JobRadar (etat actuel) - 2026-02-24

Etat
- Ingestion d'offres OK (weworkremotely, himalayas, AGL, Bourbon, AEJ CI, etc.)
- CV upload / extraction OK
- Matching + fallback automatique OK
- Digest email OK (tests manuels)
- Desinscription ajoutee et deployee
- Netlify deploy OK
- Cron auto
- Job cron actif (jobid 17), schedule `0 7 * * *`, status `succeeded` sur plusieurs jours
- La commande utilise le vrai `CRON_SECRET`

Email logs
- `notification_logs` montre `status=sent` pour `d.kacoutie@gmail.com` (provider_id ex: `576d40e5-37fc-402b-b90e-533a24a13c1d`)
- Email confirme

Desinscription
- Migration: `20260218120000_add_notification_prefs.sql`
- Edge function: `index.ts` + `config.toml`
- Lien "Se desinscrire" ajoute dans `send_digest`

send_digest
- Ignorer `notification_prefs.digest_enabled = false`
- Inclure lien unsubscribe signe
- Fallback automatique si aucun match

Chiffres actuels
- Jobs actifs: 3143
- Cote d'Ivoire: 309
- Afrique de l'Ouest: 324
- Stages: 118
- Metiers techniques: 30

Reste a verifier
- Gmail ne recoit pas toujours malgre `status=sent` -> verifier Resend dashboard / deliverability
- Parmi tous ces testeurs en PJ, aucun n'a recu d'email automatique d'alerte ou le digest quotidien configure
