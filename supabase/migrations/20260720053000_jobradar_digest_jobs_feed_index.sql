-- Index partiel pour la requete "jobs actifs les plus recents" utilisee par
-- send_job_alert_digest_v2 (et potentiellement d'autres flux similaires).
--
-- Diagnostic du 20/07/2026, teste en dry-run apres la mise en place du
-- nouveau cron de relance (cron_send_job_alert_digest_reactivation) : les
-- 25 appels ont tous echoue avec "jobs_lookup_failed" /
-- "canceling statement due to statement timeout", au meme timestamp.
--
-- Cause : public.jobs contient 1 123 846 lignes (253 099 actives). La
-- requete filtre is_active/is_expired/job_status puis trie sur QUATRE
-- colonnes en cascade (published_at, posted_at, scraped_at, created_at,
-- toutes DESC NULLS LAST) -- aucun index existant (jobs_sort_at_idx,
-- jobs_feed_gate_idx) ne correspond a ce filtre + tri exact. Postgres doit
-- donc trier une grande partie de la table a chaque appel. La colonne
-- generee sort_at (= coalesce(published_at, created_at)) existe deja mais
-- ne reproduit pas exactement la meme priorite (elle saute posted_at et
-- scraped_at) -- changer le tri de la requete pour l'utiliser modifierait
-- l'ordre de tri dans certains cas limites, donc non retenu ici.
--
-- Fix : index partiel qui correspond exactement au filtre et au tri deja
-- utilises par la requete. Comportement et resultats identiques, seule la
-- vitesse change.
--
-- IMPORTANT : CREATE INDEX CONCURRENTLY ne peut pas s'executer dans un bloc
-- de transaction (begin/commit). Exception deliberee a la convention
-- habituelle des migrations de ce projet, necessaire techniquement pour ne
-- pas verrouiller la table jobs (1.1M lignes, en ecriture continue via les
-- crons d'ingestion) pendant la construction de l'index.

create index concurrently if not exists jobs_digest_feed_sort_idx
  on public.jobs (
    published_at desc nulls last,
    posted_at desc nulls last,
    scraped_at desc nulls last,
    created_at desc nulls last
  )
  where is_active = true
    and (is_expired = false or is_expired is null)
    and job_status in ('active', 'stale');
