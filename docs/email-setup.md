# Configuration de l’email contact@go4jobapp.com

Objectif : garantir la réception des messages envoyés depuis la page Contact (email + WhatsApp).

## 1) Créer la boîte ou redirection
Choisir un fournisseur :
- Google Workspace
- Microsoft 365
- Zoho Mail
- Cloudflare Email Routing (redirige vers une boîte existante)

Créer l’adresse `contact@go4jobapp.com` (ou un alias) et configurer la redirection vers l’adresse support interne.

## 2) DNS minimum recommandé
Configurer la zone DNS pour `go4jobapp.com` :
- MX (selon le fournisseur choisi)
- SPF (ex: `v=spf1 include:_spf.google.com ~all`)
- DKIM (clé fournie par le fournisseur)
- DMARC (ex: `v=DMARC1; p=none; rua=mailto:postmaster@go4jobapp.com`)

## 3) Envoi via Resend (Edge Function)
Configurer les secrets Supabase :
- `RESEND_API_KEY`
- `RESEND_FROM` (ex: `Go4Job <no-reply@go4jobapp.com>`)
- `CONTACT_EMAIL` (ex: `contact@go4jobapp.com`)

Sans ces variables, les messages seront enregistrés en base mais aucun email ne sera envoyé.

## 4) Vérification
- Envoyer un message via la page Contact.
- Vérifier l’insertion dans `contact_messages`.
- Vérifier la réception sur `contact@go4jobapp.com`.
- Vérifier que l’email n’atterrit pas en spam (ajuster SPF/DKIM/DMARC si besoin).
