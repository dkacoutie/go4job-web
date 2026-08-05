-- Troisième et dernier correctif de l'incident cron découvert le 05/08/2026
-- (voir 20260805170000 et 20260805171500). L'ambiguïté de signature est
-- réglée et confirmée (le cron jobradar-job-lifecycle-hourly s'exécute à
-- nouveau sans erreur "not unique"), mais son passage de 06:20 UTC a
-- ensuite dépassé le statement_timeout de 120s de la base avant d'avoir
-- terminé toutes ses étapes.
--
-- Cause : private.jobradar_source_freshness_window(), appelée à chaque
-- exécution de jobradar_job_lifecycle_maintenance, calcule pour chaque
-- source deux compteurs (nombre d'offres actives/stale, nombre d'offres
-- vues dans les dernières 24h) via UN seul balayage groupé sur TOUTE la
-- table jobs -- 1 456 206 lignes au 05/08/2026, actives/stale/expirées/
-- tombstoned confondues -- alors que le résultat n'est utilisé qu'au
-- travers d'une jointure avec des offres déjà actives ou stale (~424 000
-- lignes). Combiner deux conditions FILTER différentes dans un seul
-- balayage empêche par ailleurs Postgres d'utiliser les index existants
-- sur job_status et sur (job_source_id, last_seen_at).
--
-- Correctif : séparer le calcul en deux agrégations indépendantes, chacune
-- filtrée dès le WHERE pour pouvoir s'appuyer sur un index :
--   - "catalogue" restreint à job_status in ('active','stale') -- résultat
--     strictement identique à l'ancien calcul (le FILTER faisait déjà
--     exactement cette restriction, elle est juste déplacée plus tôt).
--   - "seen_24h" reste calculé sur TOUTE la table comme avant (aucune
--     restriction de statut dans la version d'origine) pour ne rien
--     changer au comportement -- mais peut désormais s'appuyer sur l'index
--     jobs_job_source_last_seen_idx (job_source_id, last_seen_at desc).
-- Les deux sont ensuite recombinées par un FULL OUTER JOIN. Une source qui
-- n'a ni offre active/stale ni offre vue dans les dernières 24h disparaît
-- du résultat au lieu d'y figurer avec deux zéros comme avant -- sans
-- conséquence : cette fonction n'est utilisée que jointe à des offres
-- active/stale (jobradar_job_lifecycle_maintenance, étapes 2 à 4), donc
-- une source sans aucune offre active/stale ne peut de toute façon jamais
-- matcher cette jointure.
--
-- Signature, sécurité (STABLE SECURITY DEFINER, search_path fixe) et
-- résultat inchangés pour tous les cas qui comptent réellement.

create or replace function private.jobradar_source_freshness_window()
 returns table(job_source_id uuid, window_days numeric)
 language sql
 stable security definer
 set search_path to 'public', 'private'
as $function$
  with catalogue_counts as (
    select
      j.job_source_id,
      count(*)::numeric as catalogue
    from public.jobs j
    where j.job_source_id is not null
      and j.job_status in ('active'::public.job_lifecycle_status,
                            'stale'::public.job_lifecycle_status)
    group by j.job_source_id
  ),
  seen_counts as (
    select
      j.job_source_id,
      count(*)::numeric as seen_24h
    from public.jobs j
    where j.job_source_id is not null
      and j.last_seen_at > now() - interval '24 hours'
    group by j.job_source_id
  ),
  thr as (
    select
      coalesce(c.job_source_id, s.job_source_id) as job_source_id,
      coalesce(s.seen_24h, 0) as seen_24h,
      coalesce(c.catalogue, 0) as catalogue
    from catalogue_counts c
    full outer join seen_counts s on s.job_source_id = c.job_source_id
  )
  select
    t.job_source_id,
    least(
      greatest(
        3.0,
        case
          when t.seen_24h > 0 then (t.catalogue / t.seen_24h) * 2.0
          else 3.0
        end
      ),
      greatest(coalesce(js.ttl_days, 30)::numeric, 3.0)
    ) as window_days
  from thr t
  join public.job_sources js on js.id = t.job_source_id;
$function$;
