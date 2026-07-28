-- =============================================================================
-- JobRadar — Les abonnements expirés gardaient le statut 'active'
--
-- Constat du 28/07/2026 : 3 abonnements portaient status = 'active' alors que
-- leur ends_at était dépassé depuis environ 118 jours. Rien ne mettait ce
-- statut à jour au passage de la date. Toute requête ou tout tableau de bord
-- comptant les abonnements actifs surestimait donc le parc client.
--
-- C'est le même mode de défaillance que le compteur d'offres corrigé la même
-- nuit : une colonne dérivée qu'aucun processus ne maintient, et qui finit par
-- raconter une histoire plus flatteuse que la réalité.
--
-- La facturation elle-même n'a pas été trompée : has_active_pass() vérifie
-- ends_at et non le statut. C'est uniquement l'observabilité qui mentait.
--
-- État après correction : 12 expirés (tous avec date dépassée), 2 actifs
-- (aucun avec date dépassée).
-- =============================================================================

begin;

create or replace function public.jobradar_expire_stale_subscriptions()
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n int;
begin
  update public.billing_subscriptions
  set status = 'expired',
      updated_at = now()
  where status = 'active'
    and ends_at is not null
    and ends_at <= now();

  get diagnostics v_n = row_count;

  if v_n > 0 then
    insert into public.jobradar_health_events(level, code, details)
    values ('info', 'subscriptions_expired_cleanup',
            jsonb_build_object('rows', v_n, 'at', now()));
  end if;

  return v_n;
end;
$function$;

comment on function public.jobradar_expire_stale_subscriptions() is
  'Passe a expired les abonnements dont ends_at est depasse mais dont le statut est reste active.';

-- Rattrapage de l'existant.
select public.jobradar_expire_stale_subscriptions();

commit;

-- -----------------------------------------------------------------------------
-- Planification appliquée séparément (cron.job appartient à supabase_admin) :
--
--   select cron.schedule(
--     'jobradar_expire_stale_subscriptions',
--     '25 * * * *',
--     $$select public.jobradar_expire_stale_subscriptions();$$
--   );
--
-- Créé le 28/07/2026 sous le jobid 61.
-- -----------------------------------------------------------------------------
