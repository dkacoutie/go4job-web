-- Backfill country_codes pour emploisenegal_portal.
--
-- Contexte : le connecteur assigne desormais ["SN"] a chaque offre des
-- son ingestion (commit c40ba10), mais les 49 offres existantes ont ete
-- collectees le 09/05/2026, avant ce correctif, et ont country_codes a NULL.
--
-- Portee strictement bornee : uniquement les lignes de job_sources.code =
-- 'emploisenegal_portal' avec country_codes IS NULL. Aucune autre source
-- n'est touchee.
--
-- Justification de la valeur ["SN"] : le connecteur ne collecte que la
-- categorie /offre-emploi-senegal/ du site (filtre sur sourceUrl), donc
-- toutes les offres de cette source sont bien basees au Senegal (verifie
-- manuellement : 44/49 offres a Dakar ou en ville senegalaise, 4 avec
-- mention "International" generique du site lui-meme, aucune offre
-- identifiee dans un autre pays).

begin;

update jobs j
set country_codes = array['SN']::text[]
from job_sources js
where js.id = j.job_source_id
  and js.code = 'emploisenegal_portal'
  and j.country_codes is null;

commit;
