# AGENTS.md — JobRadar / CapCarrière

Ce fichier donne à Codex le contexte du projet en début de session.

## Repo

- Repo : dkacoutie/go4job-web
- Branche de travail : dev
- Dossier local : D:\Projets\01_SaaS_Actifs\JobRadar_Go4Job\go4job-web
- Pas d'environnement de staging. Un seul projet Supabase (go4job, AWS eu-north-1).

## Règles Git

- Toujours travailler sur dev.
- Ne jamais committer sans validation explicite du porteur du projet.
- Un commit = un seul sujet.
- Toujours vérifier git status -sb avant et après chaque commit.
- Ne jamais committer .env, secrets, clés API, tokens.

## Règles Supabase

- Rôle read-only (claude_readonly_audit) pour tout audit courant. Ne jamais utiliser service_role.
- Toute migration SQL est écrite dans un fichier versionné, puis exécutée manuellement via le SQL Editor (pas de CI/CD pour les migrations).
- Toujours faire un dry-run (SELECT) avant un UPDATE ou toute opération destructive.
- Migrations SQL manuelles toujours dans une transaction explicite (begin; / commit;).
- cron.job appartient à supabase_admin : jamais d'UPDATE direct dessus, utiliser cron.alter_job().
- Les Edge Functions sont déployées manuellement (supabase functions deploy). Le code déployé peut ne pas correspondre au code du dépôt tant que le déploiement n'a pas été fait : toujours vérifier séparément.

## Méthode attendue pour chaque mission

1. Lire le contexte.
2. Auditer, en lecture seule.
3. Identifier les risques.
4. Proposer un plan.
5. Attendre validation.
6. Modifier seulement si validé.
7. Tester / vérifier.
8. Proposer un commit clair, un seul sujet.

## Points de vigilance connus

- **projobivoire_rss** est en réalité panafricain (CI, Gabon, Maroc, Mauritanie, Maurice, Rwanda, Tchad, Afrique du Sud constatés dans les données au 20/07/2026), pas limité à l'Afrique de l'Ouest malgré son nom. Ne jamais supposer qu'une source ne couvre que le pays annoncé dans son nom sans vérifier son contenu réel.
- **emploisenegal_portal** : country_codes vaut ["SN"] en dur pour toute offre collectée (filtre sur l'URL de catégorie du site, pas de détection texte). Fiable tant que la structure du site ne change pas. La source est bloquée par Cloudflare depuis mai 2026 : si elle se débloque, relire manuellement le premier lot collecté avant de faire confiance au flux en continu.
- **rss_ngojobsinafrica** (NGO Jobs in Africa) : le connecteur d'ingestion n'extrait pas le pays par offre, seulement "AFRICA" en générique. 104 offres actives au 20/07/2026 sans country_codes exploitable — non couvert par le backfill du 20/07/2026 (migration 20260720070000) car un tag panafricain générique aurait été trompeur (ni un pays précis, ni "remote"). Reste à corriger à la source (extraction du pays réel depuis le contenu de chaque offre) si ce connecteur prend de l'ampleur.
- Avant d'assigner un country_code fixe à une nouvelle source, toujours vérifier si le site ou le flux est mono-pays ou multi-pays. En cas de doute, échantillonner les offres réelles (titre, localisation) plutôt que de supposer.
- Audit du 20/07/2026 (migration 20260720070000_jobradar_country_codes_hygiene.sql) : couverture country_codes sur les offres actives passée de 35% à 99,9% (casse fr/gb normalisée + backfill FR/US/DE/CA/GB/CI/BE/NG + tag WW pour les sources remote/multi-pays). emploi_ma, hotnigerianjobs, jobberman_ng, jobberman_gh sont actuellement inactifs (aucune offre en base) — à réauditer sur ce même point le jour où ils seraient réactivés.

## Outils disponibles pour Codex

- MCP postgres-audit : rôle claude_readonly_audit (lecture seule).
- MCP github : accès lecture seule au dépôt.
- Context7.
