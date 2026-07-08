-- Add missing indexes on FK columns identified by the index audit (2026-07-07/08).
-- All target tables are tiny today (0-260 rows) — a plain CREATE INDEX is safe here,
-- no CONCURRENTLY needed (build time is sub-millisecond, no meaningful lock duration).

begin;

create index if not exists applications_job_id_idx on public.applications (job_id);
create index if not exists matches_user_id_idx on public.matches (user_id);
create index if not exists candidatures_user_id_idx on public.candidatures (user_id);
create index if not exists subscriptions_user_id_idx on public.subscriptions (user_id);
create index if not exists subscriptions_plan_id_idx on public.subscriptions (plan_id);
create index if not exists channels_user_id_idx on public.channels (user_id);
create index if not exists email_logs_sequence_id_idx on public.email_logs (sequence_id);
create index if not exists marketing_email_queue_user_id_idx on public.marketing_email_queue (user_id);
create index if not exists partner_payouts_created_by_user_id_idx on public.partner_payouts (created_by_user_id);
create index if not exists partner_payouts_paid_by_user_id_idx on public.partner_payouts (paid_by_user_id);
create index if not exists billing_payments_plan_id_idx on public.billing_payments (plan_id);
create index if not exists billing_subscriptions_plan_id_idx on public.billing_subscriptions (plan_id);
create index if not exists job_matches_job_id_idx on public.job_matches (job_id);

commit;
