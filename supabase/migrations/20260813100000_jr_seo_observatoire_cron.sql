-- JR-SEO : cron quotidien de rafraichissement du snapshot Observatoire.
--
-- 03:20 UTC choisi pour eviter les autres jobs quotidiens deja en place
-- (heal_expired_jobs_daily a 01:10, jobradar-aej-ci-deep-rotation a 02:30,
-- jobradar_daily_digest a 07:00 -- verifie via cron.job le 13/08/2026).
--
-- Cout mesure a la mise au point (13/08/2026) : jusqu'a ~13s pour un seul
-- GROUP BY contract_type sans filtre pays, faute d'index couvrant sur ce
-- champ -- attendu et accepte ici (voir commentaire dans
-- 20260813080000_jr_seo_observatoire_snapshot.sql), cette fonction ne
-- tourne qu'une fois par jour hors heures de pointe, jamais sur une requete
-- publique. Pas de nouvel index cree pour cette seule fonction : le cout
-- reste borne a un job quotidien, et ce depot vient deja de nettoyer un
-- index inutilise ce soir (jobs_desc_status_idx) -- pas de raison d'en
-- ajouter un nouveau sans un besoin recurrent plus frequent.
select cron.schedule(
  'jobradar_refresh_observatoire_snapshot_daily',
  '20 3 * * *',
  $$select public.jobradar_refresh_observatoire_snapshot();$$
);
