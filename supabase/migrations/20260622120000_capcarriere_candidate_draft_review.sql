-- CapCarrière candidate review.
-- Records an explicit approve/reject decision without sending an email or
-- creating an application in the JobRadar applications table.

begin;

drop policy if exists "cc_cv_versions_select_own"
  on public.cc_cv_versions;

create policy "cc_cv_versions_select_own"
on public.cc_cv_versions
for select
to authenticated
using (user_id = auth.uid());

create or replace function public.cc_review_application_draft(
  p_draft_id uuid,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_draft public.cc_application_drafts%rowtype;
  v_next_status text;
  v_event_type text;
  v_now timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'authentication_required';
  end if;

  if p_decision not in ('approve', 'reject') then
    raise exception 'invalid_decision';
  end if;

  select *
  into v_draft
  from public.cc_application_drafts
  where id = p_draft_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'draft_not_found';
  end if;

  if v_draft.status not in ('draft', 'needs_user_review') then
    raise exception 'draft_already_reviewed';
  end if;

  if p_decision = 'approve' then
    v_next_status := 'approved_by_user';
    v_event_type := 'user_approved';

    update public.cc_application_drafts
    set
      status = v_next_status,
      user_reviewed_at = v_now,
      user_approved_at = v_now,
      user_consent_at = v_now,
      cancelled_at = null
    where id = v_draft.id;
  else
    v_next_status := 'cancelled';
    v_event_type := 'user_rejected';

    update public.cc_application_drafts
    set
      status = v_next_status,
      user_reviewed_at = v_now,
      user_approved_at = null,
      user_consent_at = null,
      cancelled_at = v_now
    where id = v_draft.id;
  end if;

  insert into public.cc_application_events (
    draft_id,
    user_id,
    event_type,
    from_status,
    to_status,
    triggered_by,
    metadata_json
  )
  values (
    v_draft.id,
    v_user_id,
    v_event_type,
    v_draft.status,
    v_next_status,
    'user',
    jsonb_build_object(
      'decision', p_decision,
      'email_sent', false,
      'application_submitted', false
    )
  );

  return jsonb_build_object(
    'id', v_draft.id,
    'status', v_next_status,
    'user_reviewed_at', v_now,
    'email_sent', false,
    'application_submitted', false
  );
end;
$$;

revoke all on function public.cc_review_application_draft(uuid, text) from public;
grant execute on function public.cc_review_application_draft(uuid, text) to authenticated;

comment on function public.cc_review_application_draft(uuid, text) is
  'Atomically records a candidate approve/reject decision. It never sends email and never creates a JobRadar application.';

commit;
