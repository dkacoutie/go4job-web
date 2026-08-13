-- JR-SEO-audit-20260812, sitemap dynamique : opportunite #1 identifiee dans
-- l'audit ("le sitemap ne couvre pas les pages d'offres" -- 359 536 pages
-- qualifiees au moment de l'audit, 353 299 verifiees a l'application de
-- cette migration -- 0 dans le sitemap.xml statique actuel).
--
-- Nouvelle RPC publique, meme patron de securite que les autres RPC
-- "vitrine" (jobradar_public_jobs_preview et consorts) : SECURITY DEFINER,
-- colonnes volontairement restreintes (id + updated_at seulement -- un
-- sitemap n'a besoin de rien de plus), pas de GRANT direct sur jobs a anon.
--
-- Le critere de qualification reprend exactement celui deja utilise cote
-- frontend pour decider d'emettre le JSON-LD JobPosting (buildJobPostingSchema,
-- src/lib/jobPostingSchema.ts) : title, company_name, un extrait de
-- description, posted_at, et une localisation exploitable (location ou
-- remote non-hybride). Ne pas dupliquer un second critere different aurait
-- cree un decalage entre "page presente dans le sitemap" et "page portant
-- un balisage JobPosting valide".
--
-- Pagination par id (keyset, "id > p_after order by id limit p_limit"),
-- pas par OFFSET : a 353k+ lignes, un OFFSET profond degraderait a chaque
-- page suivante.

-- CREATE INDEX CONCURRENTLY ne peut pas s'executer dans un bloc
-- transactionnel explicite -- cette instruction doit rester hors de tout
-- begin/commit, executee statement par statement si applique manuellement
-- (comme pour les migrations 20260813000000 et 20260813010000).
--
-- Deux essais sur cette migration, le premier insuffisant :
-- v1 (id seul, sans INCLUDE, sans le critere complet dans le predicat) :
-- testee en EXPLAIN ANALYZE avant application -- 21,5s pour une page de
-- 50000 lignes. Cause : les id sont des UUID, sans correlation avec
-- l'ordre physique des lignes sur disque -- chaque ligne visitee dans
-- l'ordre de l'index declenchait une lecture disque quasi aleatoire
-- (41029 lectures constatees). v2 (celle ci-dessous) : le critere complet
-- de qualification est deplace dans le predicat de l'index (au lieu d'un
-- filtre residuel apres coup), et updated_at/expires_at sont ajoutes en
-- INCLUDE -- la requete devient un index-only scan (aucun acces disque
-- par ligne, hors verification de visibilite). Resultat mesure : ~1,4 a
-- 1,7s pour une page de 50000 lignes, sur la premiere page comme sur une
-- page avec curseur. "expires_at > now()" reste hors du predicat de
-- l'index (now() n'est pas IMMUTABLE, invalide dans un index partiel),
-- mais expires_at est disponible en lecture directe depuis l'index via
-- INCLUDE -- toujours pas d'acces disque necessaire pour l'evaluer.
--
-- Note de vigilance (meme session, cf. migration 20260813010000) : jobs
-- porte deja 40+ index, et l'ecriture en a paye le prix ce soir (cron en
-- echec du fait de la maintenance d'index sur chaque UPDATE). Celui-ci
-- reprend le meme triplet de predicat (is_active, is_expired,
-- quality_status) que idx_jobs_active_feed_covering / jobs_feed_gate_idx
-- deja existants, plus les criteres de completude (title/company_name/
-- description/posted_at/location) qui ne bougent quasiment jamais une
-- fois une offre en base -- le surcout d'ecriture marginal reste faible
-- et concentre sur les colonnes deja indexees ailleurs.

create index concurrently if not exists idx_jobs_public_sitemap_id
  on jobs (id) include (updated_at, expires_at)
  where is_active = true
    and is_expired = false
    and (quality_status = 'ok' or quality_status is null)
    and title is not null and btrim(title) <> ''
    and company_name is not null and btrim(company_name) <> ''
    and coalesce(nullif(btrim(description_text), ''), nullif(btrim(official_desc), '')) is not null
    and posted_at is not null
    and (
      nullif(btrim(location), '') is not null
      or (
        lower(coalesce(remote_type, '')) like '%remote%'
        and lower(coalesce(remote_type, '')) not like '%hybrid%'
      )
    );

begin;

create or replace function public.jobradar_public_sitemap_page(
  p_after uuid default null,
  p_limit int default 50000
)
returns table (
  id uuid,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  return query
  select j.id, j.updated_at
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
    and (p_after is null or j.id > p_after)
  order by j.id
  limit least(greatest(coalesce(p_limit, 50000), 1), 50000);
end;
$$;

revoke all on function public.jobradar_public_sitemap_page(uuid, int) from public;
grant execute on function public.jobradar_public_sitemap_page(uuid, int) to anon, authenticated;

commit;
