-- JR-0037 : backfill remote_type depuis description_text (idempotente, parité Git/historique migrations)
-- L'essentiel du travail a déjà été appliqué en production par 14 lots de ~100 000 lignes
-- (execute_sql, balayage complet de la table par curseur d'id UUID croissant, session du 09/08/2026).
-- Cette migration ne fait que rejouer la même règle sur un lot borné pour rester dans le budget
-- de statement_timeout (un scan non borné sur ~1,35M lignes de description_text expire, cf. JR-0037
-- section "Non fait" initiale). WHERE remote_type IS NULL garantit qu'aucune valeur existante n'est
-- écrasée. Idempotente : ré-exécutable sans risque, n'affecte que les lignes encore NULL.
with batch as (
  select id, description_text
  from public.jobs
  where remote_type is null
    and description_text is not null
    and length(trim(description_text)) > 0
  order by id
  limit 100000
)
update public.jobs j
set remote_type = case
  when b.description_text ~* '(hybride|hybrid)' then 'hybrid'
  when b.description_text ~* '(t[ée]l[ée]?travail|teletravail|remote|full remote|work from home)' then 'remote'
  when b.description_text ~* '(pr[ée]sentiel|presentiel|sur site|on-site|onsite)' then 'on_site'
  else j.remote_type
end
from batch b
where j.id = b.id
  and (b.description_text ~* '(hybride|hybrid|t[ée]l[ée]?travail|teletravail|remote|full remote|work from home|pr[ée]sentiel|presentiel|sur site|on-site|onsite)');
