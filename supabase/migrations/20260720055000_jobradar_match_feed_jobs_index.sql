-- Index partiel pour les requetes de public.jobs utilisees par l'edge
-- function jobradar_match_feed (feed public /jobradar/feed).
--
-- Diagnostic du 20/07/2026 : jobradar_match_feed echoue par intermittence en
-- 500 apres 11 a 17 secondes d'execution. Trois requetes internes a cette
-- fonction (recherche par mots-cles, correspondance par overlap de
-- competences/famille de metier, feed recent par defaut) partagent le meme
-- filtre de base et le meme tri :
--   where is_active = true and job_status in ('active', 'stale')
--   order by published_at desc nulls last,
--            scraped_at desc nulls last,
--            created_at desc nulls last
-- Ce filtre ne correspond a aucun index existant (jobs_digest_feed_sort_idx,
-- cree juste avant pour send_job_alert_digest_v2, exige en plus is_expired,
-- que ces requetes ne filtrent pas) -- postgres doit donc trier une grande
-- partie des 253k lignes actives de public.jobs a chaque appel.
--
-- Fix : index partiel correspondant exactement a ce filtre + tri.
-- Comportement et resultats identiques, seule la vitesse change.
--
-- IMPORTANT : CREATE INDEX CONCURRENTLY ne peut pas s'executer dans un bloc
-- de transaction (begin/commit), meme exception que pour l'index precedent.

create index concurrently if not exists jobs_match_feed_sort_idx
  on public.jobs (
    published_at desc nulls last,
    scraped_at desc nulls last,
    created_at desc nulls last
  )
  where is_active = true
    and job_status in ('active', 'stale');
