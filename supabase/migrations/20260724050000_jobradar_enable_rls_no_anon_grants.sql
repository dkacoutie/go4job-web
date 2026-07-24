-- Active RLS sur 18 tables signalées par l'audit de sécurité Supabase
-- (advisory rls_disabled) comme "fully exposed to the anon and authenticated
-- roles used by Supabase client libraries".
--
-- Vérification faite avant d'écrire cette migration (lecture seule,
-- role claude_readonly_audit) : aucune des 18 tables ci-dessous n'accorde
-- le moindre GRANT (SELECT/INSERT/UPDATE/DELETE) aux roles anon ou
-- authenticated. Confirmé indépendamment via information_schema et via
-- pg_class.relacl. Les seuls roles ayant des droits dessus sont postgres,
-- service_role et claude_readonly_audit, qui ont tous rolbypassrls = true.
--
-- Consequence concrete : ces tables ne sont, aujourd'hui, PAS lisibles ni
-- modifiables via l'API REST publique (PostgREST) meme sans RLS, car
-- PostgreSQL bloque deja l'acces au niveau des GRANT avant meme d'evaluer
-- une eventuelle policy RLS. L'avertissement generique de l'audit ne tient
-- pas compte de cet etat de fait.
--
-- Cette migration ferme malgre tout l'ecart releve par l'audit, en defense
-- en profondeur : si un GRANT etait un jour ajoute par erreur (ex: depuis
-- le Table Editor du dashboard Supabase, qui peut proposer d'accorder un
-- acces public), RLS bloquera quand meme l'acces tant qu'aucune policy
-- n'est ajoutee explicitement.
--
-- Aucune policy n'est ajoutee ici : ce n'est pas necessaire, puisque
-- postgres, service_role et claude_readonly_audit bypassent RLS
-- (rolbypassrls = true) et continueront donc de fonctionner exactement
-- comme avant sur ces tables. anon/authenticated n'avaient deja aucun acces
-- et n'en auront toujours aucun.
--
-- Non destructif : aucune ligne modifiee, aucune donnee touchee.
-- Reversible : ALTER TABLE ... DISABLE ROW LEVEL SECURITY; pour chaque
-- table listee, si necessaire.

begin;

alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.sources enable row level security;
alter table public.job_endpoints enable row level security;
alter table public.user_profiles enable row level security;
alter table public.user_notification_channels enable row level security;
alter table public.job_matches enable row level security;
alter table public.job_enrichments enable row level security;
alter table public.email_action_tokens enable row level security;
alter table public.v_secret enable row level security;
alter table public.notification_logs enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.jobradar_health_events enable row level security;
alter table public.jobradar_health_snapshots enable row level security;
alter table public.jooble_cache enable row level security;
alter table public.jooble_rate_events enable row level security;
alter table public.adzuna_cache enable row level security;
alter table public.adzuna_rate_events enable row level security;

commit;
