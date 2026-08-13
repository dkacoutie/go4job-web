-- JR-SEO-audit-20260812, suite sitemap dynamique : /sitemap.xml (kind=index)
-- retournait une erreur 504 (page d'erreur Cloudflare) en production.
--
-- Cause : la fonction Edge public_sitemap construisait l'index en
-- parcourant TOUT le catalogue qualifiant par appels RPC successifs de
-- 1000 lignes (plafond reel de l'API REST Supabase, cf. migration
-- 20260813020000) pour reperer les bornes de chaque chunk de 50000 --
-- environ 400 aller-retours HTTP pour ~353k lignes, plus d'une minute au
-- total. Un proxy en amont (Cloudflare et/ou Netlify) coupe la connexion
-- bien avant que cette boucle ne se termine.
--
-- Correctif : une seule requete SQL, executee directement cote base (pas
-- via l'API REST plafonnee a 1000 lignes/appel), qui calcule les bornes
-- de tous les chunks en un seul passage via row_number() + modulo. Teste
-- en EXPLAIN ANALYZE avant application : ~400ms pour l'ensemble du
-- catalogue qualifiant (353752 lignes au test), retournant seulement les
-- 7-8 lignes de bornes utiles -- l'index-only scan sur
-- idx_jobs_public_sitemap_id (migration 20260813020000) rend ce parcours
-- complet largement plus rapide que les 400 appels precedents cumules.

begin;

create or replace function public.jobradar_public_sitemap_chunk_bounds(
  p_chunk_size int default 50000
)
returns table (
  after_id uuid
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  return query
  with numbered as (
    select j.id, row_number() over (order by j.id) as rn
    from jobs j
    where j.is_active = true
      and j.is_expired = false
      and (j.quality_status = 'ok' or j.quality_status is null)
      and j.title is not null and btrim(j.title) <> ''
      and j.company_name is not null and btrim(j.company_name) <> ''
      and coalesce(nullif(btrim(j.description_text), ''), nullif(btrim(j.official_desc), '')) is not null
      and j.posted_at is not null
      and (
        nullif(btrim(j.location), '') is not null
        or (
          lower(coalesce(j.remote_type, '')) like '%remote%'
          and lower(coalesce(j.remote_type, '')) not like '%hybrid%'
        )
      )
      and (j.expires_at is null or j.expires_at > now())
  )
  select id
  from numbered
  where rn % greatest(coalesce(p_chunk_size, 50000), 1) = 0
  order by id;
end;
$$;

revoke all on function public.jobradar_public_sitemap_chunk_bounds(int) from public;
grant execute on function public.jobradar_public_sitemap_chunk_bounds(int) to anon, authenticated;

commit;
