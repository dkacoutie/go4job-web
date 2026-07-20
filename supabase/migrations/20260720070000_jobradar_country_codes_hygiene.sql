-- Hygiene de public.jobs.country_codes -- backfill et correction de casse.
--
-- Contexte (audit du 20/07/2026) : jobradar_feed_by_alert() classe les offres
-- en 4 paliers via country_codes && ... (target pays -> Afrique -> worldwide
-- via tag 'WW' -> "other"). Deux bugs degradaient silencieusement ce
-- classement pour la majorite du catalogue :
--
-- 1) Casse incoherente : 633 295 lignes (toutes offres confondues) avaient
--    country_codes en minuscule ('fr', 'gb') alors que le reste du systeme
--    (v_target_countries, v_africa_codes dans jobradar_feed_by_alert, le tag
--    'WW') travaille en majuscule. `'FR' = any(array['fr'])` est faux : ces
--    offres (58 891 actives pour fr, 27 957 pour gb, avant correction)
--    tombaient toutes dans le palier le plus bas ("other", geo_rank -1) au
--    lieu d'etre classees en priorite pour un utilisateur ciblant la France
--    ou le UK.
--
-- 2) country_codes NULL sur 165 213 offres actives (65% du catalogue actif),
--    faute de backfill depuis le champ texte libre `country` -- meme
--    consequence : classement au palier le plus bas par defaut.
--
-- Fix applique directement le 20/07/2026 (execution SQL en direct, avec
-- validation explicite du porteur du projet -- voir aussi les migrations
-- 20260720053000 et 20260720055000 pour le contexte de la meme session) :
--
--   a) Normalisation de casse : array_replace(country_codes, 'fr'->'FR',
--      'gb'->'GB') sur les 633 295 lignes concernees (execute par lots de
--      20k a 80k pour rester sous le statement_timeout de 2 min -- l'index
--      idx_jobs_country_codes_gin a ete temporairement supprime puis
--      recree en CONCURRENTLY pour accelerer les ecritures de masse).
--
--   b) Backfill cible depuis `country` texte -> country_codes, uniquement
--      la ou country_codes etait NULL, sur les offres actives non expirees,
--      pour les valeurs texte propres et non ambigues correspondant a un
--      seul pays (reutilise les memes alias que COUNTRY_ALIAS_MAP cote
--      front, src/lib/jobMatching.ts, pour rester coherent client/serveur) :
--        France -> FR (146 982), United States -> US (6 147),
--        Germany -> DE (688), Canada -> CA (479), United Kingdom -> GB (451),
--        CI -> CI (286), Belgique -> BE (91), Nigeria -> NG (17).
--      Le reste (valeurs texte rares ou combinaisons multi-pays ambigues,
--      ~670 variantes distinctes releguees a la longue traine) reste NULL --
--      aucune regression, juste pas d'amelioration sur ces lignes-la.
--
--   c) Tag 'WW' (deja prevu par jobradar_feed_by_alert(), branche
--      "worldwide fallback", jusque-la jamais alimentee) pour les offres
--      encore sans country_codes provenant de sources explicitement remote
--      (job_sources.region ilike '%remote%'), ou dont le champ country
--      contient une liste multi-pays (virgule) ou vaut litteralement
--      'REMOTE'. ~9 927 offres concernees.
--
-- Resultat verifie : couverture country_codes sur les offres actives passee
-- de 35% (88 327 / 253 540) a 99,9% (254 627 / 254 771). 144 lignes restent
-- NULL (longue traine non mappee, comportement inchange, pas de regression).
--
-- Ce fichier documente et reproduit l'operation pour tracabilite. Idempotent :
-- peut etre rejoue sans effet si deja applique (les conditions WHERE ne
-- trouvent alors plus aucune ligne a modifier).

begin;

-- a) Casse
update public.jobs
set country_codes = array_replace(array_replace(country_codes, 'fr', 'FR'), 'gb', 'GB')
where country_codes && array['fr', 'gb'];

-- b) Backfill cible depuis le texte
update public.jobs
set country_codes = case btrim(country)
    when 'France' then array['FR']
    when 'United States' then array['US']
    when 'Germany' then array['DE']
    when 'Canada' then array['CA']
    when 'United Kingdom' then array['GB']
    when 'CI' then array['CI']
    when 'Belgique' then array['BE']
    when 'Nigeria' then array['NG']
  end
where is_active = true
  and (is_expired = false or is_expired is null)
  and country_codes is null
  and btrim(country) in ('France', 'United States', 'Germany', 'Canada', 'United Kingdom', 'CI', 'Belgique', 'Nigeria');

-- c) Tag worldwide pour les sources/valeurs explicitement remote ou multi-pays
update public.jobs j
set country_codes = array['WW']
from public.job_sources js
where js.id = j.job_source_id
  and j.is_active = true
  and (j.is_expired = false or j.is_expired is null)
  and j.country_codes is null
  and (js.region ilike '%remote%' or j.country ilike '%,%' or j.country ilike 'REMOTE');

commit;

-- Note d'execution : sur la volumetrie reelle (1,1M lignes), les UPDATE
-- ci-dessus doivent etre executes par lots (LIMIT + table de suivi
-- temporaire) pour rester sous le statement_timeout de 2 minutes -- la
-- version ci-dessus, en un seul UPDATE par etape, est correcte
-- fonctionnellement mais peut necessiter d'etre rejouee par lots si elle
-- timeout sur un chargement a froid. Envisager aussi de supprimer
-- temporairement idx_jobs_country_codes_gin puis de le recreer en
-- CONCURRENTLY si l'ecriture de masse est trop lente avec l'index en place.
