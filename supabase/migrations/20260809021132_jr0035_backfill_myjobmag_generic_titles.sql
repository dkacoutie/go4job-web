-- JR-0035 (09/08/2026) : correctif des titres génériques MyJobMag Nigeria.
-- Voir diagnostic complet JR-0034. Idempotent : la clause WHERE n'affecte
-- plus aucune ligne une fois le correctif appliqué (déjà exécuté via
-- execute_sql le 09/08/2026 ; cette migration l'enregistre formellement
-- dans l'historique Supabase pour parité avec le dépôt Git).
update public.jobs
set title = trim(title || ' at ' || company_name)
where job_source_id = '86176530-fa04-44dc-a4f6-273ccbec4fca'
  and title in ('Latest Jobs', 'Job Vacancies', 'More Jobs')
  and company_name is not null
  and length(trim(company_name)) > 0;
