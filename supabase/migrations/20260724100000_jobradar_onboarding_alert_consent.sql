begin;

-- Ajustement 1+2 (spec activation/paiement, session Cowork du 24/07/2026) :
-- alerte gratuite creee uniquement apres consentement explicite pendant
-- l'onboarding (bouton "Voir mes offres et activer mon alerte gratuite" sur
-- l'ecran Preferences), de maniere idempotente : un passage repete dans
-- l'onboarding, une modification des preferences, un double clic ou deux
-- onglets simultanes ne doivent jamais creer plusieurs alertes "onboarding"
-- ni ecraser une alerte creee manuellement par l'utilisateur.

alter table public.alerts
  add column if not exists source text not null default 'manual';

alter table public.alerts
  drop constraint if exists alerts_source_check;
alter table public.alerts
  add constraint alerts_source_check check (source in ('manual', 'onboarding'));

-- Un seul emplacement "onboarding" par utilisateur. C'est cette contrainte,
-- pas un debounce cote frontend, qui garantit l'idempotence : deux appels
-- concurrents (deux onglets, double clic) se resolvent au niveau Postgres.
create unique index if not exists alerts_one_onboarding_per_user
  on public.alerts (user_id)
  where source = 'onboarding';

create or replace function public.jobradar_upsert_onboarding_alert(
  p_name text,
  p_keywords text[],
  p_countries text[],
  p_frequency text default 'daily'
)
returns public.alerts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_has_active_pass boolean;
  v_active_count integer;
  v_existing_onboarding public.alerts;
  v_result public.alerts;
  v_clean_name text;
  v_clean_keywords text[];
  v_clean_countries text[];
  v_clean_frequency text;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  v_clean_name := nullif(btrim(coalesce(p_name, '')), '');
  if v_clean_name is null then
    v_clean_name := 'Mon alerte JobRadar';
  end if;

  select array_agg(distinct btrim(k)) into v_clean_keywords
  from unnest(coalesce(p_keywords, array[]::text[])) as k
  where btrim(k) <> '';

  if v_clean_keywords is null or array_length(v_clean_keywords, 1) is null then
    raise exception 'keywords_required';
  end if;

  if p_countries is null or array_length(p_countries, 1) is null then
    v_clean_countries := null; -- null = tous pays, convention deja utilisee par AlertsPage
  else
    select array_agg(distinct btrim(c)) into v_clean_countries
    from unnest(p_countries) as c
    where btrim(c) <> '';
  end if;

  v_clean_frequency := case
    when p_frequency in ('instant', 'daily', 'weekly') then p_frequency
    else 'daily'
  end;

  select exists(
    select 1
    from public.billing_subscriptions bs
    where bs.user_id = v_user_id
      and bs.status = 'active'
      and bs.ends_at > now()
  ) into v_has_active_pass;

  select * into v_existing_onboarding
  from public.alerts
  where user_id = v_user_id and source = 'onboarding'
  limit 1;

  if v_existing_onboarding.id is not null then
    update public.alerts
    set name = v_clean_name,
        keywords = v_clean_keywords,
        countries = v_clean_countries,
        country = (case when v_clean_countries is not null then v_clean_countries[1] else null end),
        frequency = v_clean_frequency,
        channels = array['email'],
        is_active = true,
        updated_at = now()
    where id = v_existing_onboarding.id
    returning * into v_result;

    return v_result;
  end if;

  -- Pas encore d'alerte "onboarding". Si l'utilisateur est en gratuit et a
  -- deja au moins une alerte active (creee manuellement ailleurs), la limite
  -- gratuite (1 alerte active, cf. FREE_ACTIVE_ALERT_LIMIT dans AlertsPage.tsx
  -- et JobRadarFeedPage.tsx) est deja satisfaite : on ne cree pas de
  -- deuxieme ligne qui la depasserait, on renvoie l'alerte existante.
  if not v_has_active_pass then
    select count(*) into v_active_count
    from public.alerts
    where user_id = v_user_id and is_active = true;

    if v_active_count >= 1 then
      select * into v_result
      from public.alerts
      where user_id = v_user_id and is_active = true
      order by created_at asc
      limit 1;

      return v_result;
    end if;
  end if;

  insert into public.alerts (
    user_id, name, keywords, countries, country, frequency, channels, is_active, source
  )
  values (
    v_user_id,
    v_clean_name,
    v_clean_keywords,
    v_clean_countries,
    (case when v_clean_countries is not null then v_clean_countries[1] else null end),
    v_clean_frequency,
    array['email'],
    true,
    'onboarding'
  )
  on conflict (user_id) where (source = 'onboarding')
  do update set
    name = excluded.name,
    keywords = excluded.keywords,
    countries = excluded.countries,
    country = excluded.country,
    frequency = excluded.frequency,
    updated_at = now()
  returning * into v_result;

  return v_result;
end;
$$;

comment on function public.jobradar_upsert_onboarding_alert is
  'Cree ou met a jour, de maniere idempotente, l''alerte gratuite issue du consentement explicite donne en onboarding (spec activation/paiement du 24/07/2026). Ne cree jamais une deuxieme alerte "onboarding" pour le meme utilisateur (contrainte unique alerts_one_onboarding_per_user) et respecte la limite gratuite d''une alerte active en reutilisant l''alerte existante le cas echeant. Ne touche jamais aux alertes de source manual.';

revoke all on function public.jobradar_upsert_onboarding_alert(text, text[], text[], text) from public;
grant execute on function public.jobradar_upsert_onboarding_alert(text, text[], text[], text) to authenticated;

commit;
