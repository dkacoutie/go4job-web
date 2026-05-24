-- JobRadar Alertes affinees V1.
-- NULL = critere avance non configure; '{}'::text[] = critere configure mais vide.

alter table public.alerts
  add column if not exists skills_keywords text[] default null,
  add column if not exists excluded_keywords text[] default null;

comment on column public.alerts.skills_keywords is
  'Alertes affinees V1: NULL = critere non configure; tableau vide = configure sans mot. Competences ou outils optionnels donnant un leger boost au digest email.';

comment on column public.alerts.excluded_keywords is
  'Alertes affinees V1: NULL = critere non configure; tableau vide = configure sans mot. Mots excluant une offre correspondante du digest email.';
