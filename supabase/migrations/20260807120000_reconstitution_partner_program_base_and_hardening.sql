-- JR-0007 / JR-0016 / JR-0017 : reconciliation de la derive Git/Supabase.
--
-- Deux migrations existent dans l'historique Supabase (list_migrations) sans
-- fichier correspondant dans ce depot : 20260326110000_partner_program_base
-- et 20260326123000_partner_program_hardening. Confirme le 07/08/2026 par
-- comparaison directe entre `list_migrations` (MCP Supabase) et le contenu
-- reel du dossier supabase/migrations sur la branche dev via GitHub.
--
-- CE FICHIER N'EST PAS LE TEXTE ORIGINAL DE CES DEUX MIGRATIONS. Il est
-- reconstitue le 07/08/2026 a partir de l'etat reel actuel de la base
-- (information_schema, pg_constraint, pg_policies, pg_get_functiondef) pour
-- que le depot reflete la structure existante. NE PAS EXECUTER CE FICHIER EN
-- PRODUCTION : la structure qu'il decrit existe deja. Son seul but est de
-- combler l'ecart entre le depot et la base pour les futurs `supabase db
-- diff` et pour toute nouvelle session qui doit comprendre le schema reel.
--
-- Perimetre couvert : tables partner_accounts, partner_conversions,
-- partner_commissions, partner_payouts ; leurs contraintes et policies RLS ;
-- les fonctions partner_request_apply, partner_admin_upsert_account,
-- partner_admin_approve_commission, partner_admin_void_commission,
-- partner_admin_create_payout, partner_admin_attach_commissions_to_payout,
-- partner_admin_mark_payout_paid, partner_commission_rate_for_sale_number,
-- process_partner_conversion_from_payment.

-- ============================================================
-- TABLES
-- ============================================================

create table if not exists public.partner_accounts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid unique references auth.users(id) on delete set null,
    status text not null default 'pending'
      check (status = any (array['pending','active','paused','inactive'])),
    display_name text not null
      check (coalesce(length(nullif(btrim(display_name), '')), 0) > 0),
    contact_name text,
    contact_email text,
    referral_code text not null unique,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    application_message text,
    terms_accepted_at timestamptz,
    terms_version text,
    constraint partner_accounts_check
      check (user_id is not null or coalesce(length(nullif(btrim(contact_email), '')), 0) > 0)
  );

create table if not exists public.partner_conversions (
    id uuid primary key default gen_random_uuid(),
    partner_id uuid not null references public.partner_accounts(id) on delete cascade,
    billing_payment_id uuid not null unique references public.billing_payments(id) on delete cascade,
    customer_user_id uuid not null references auth.users(id) on delete cascade,
    billing_plan_id uuid not null references public.billing_plans(id) on delete restrict,
    referral_code_used text not null,
    attribution_method text not null default 'referral_code',
    status text not null default 'attributed'
      check (status = any (array['attributed','disqualified'])),
    is_first_paid_subscription boolean not null default false,
    disqualification_reason text,
    converted_at timestamptz not null default now(),
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

create table if not exists public.partner_payouts (
    id uuid primary key default gen_random_uuid(),
    partner_id uuid not null references public.partner_accounts(id) on delete cascade,
    status text not null default 'draft'
      check (status = any (array['draft','approved','paid','failed','cancelled'])),
    currency text not null,
    amount_minor integer not null check (amount_minor >= 0),
    payment_method text,
    payment_reference text,
    notes text,
    created_by_user_id uuid references auth.users(id) on delete set null,
    paid_by_user_id uuid references auth.users(id) on delete set null,
    approved_at timestamptz,
    paid_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

create table if not exists public.partner_commissions (
    id uuid primary key default gen_random_uuid(),
    partner_id uuid not null references public.partner_accounts(id) on delete cascade,
    conversion_id uuid not null unique references public.partner_conversions(id) on delete cascade,
    billing_payment_id uuid not null unique references public.billing_payments(id) on delete cascade,
    payout_id uuid references public.partner_payouts(id) on delete set null,
    status text not null default 'pending'
      check (status = any (array['pending','approved','paid','voided'])),
    currency text not null,
    commissionable_amount_minor integer not null check (commissionable_amount_minor >= 0),
    commission_rate_percent numeric not null
      check (commission_rate_percent > 0 and commission_rate_percent <= 100),
    commission_amount_minor integer not null check (commission_amount_minor >= 0),
    sale_sequence_number integer not null check (sale_sequence_number >= 1),
    calculated_at timestamptz not null default now(),
    approved_at timestamptz,
    approved_by_user_id uuid references auth.users(id) on delete set null,
    paid_at timestamptz,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint partner_commissions_check check (status <> 'paid' or payout_id is not null)
  );

-- ============================================================
-- RLS
-- ============================================================

alter table public.partner_accounts enable row level security;
alter table public.partner_conversions enable row level security;
alter table public.partner_payouts enable row level security;
alter table public.partner_commissions enable row level security;

drop policy if exists partner_accounts_admin_select_all on public.partner_accounts;
create policy partner_accounts_admin_select_all on public.partner_accounts
  for select using (public.is_internal_admin());

drop policy if exists partner_accounts_select_own on public.partner_accounts;
create policy partner_accounts_select_own on public.partner_accounts
  for select using (user_id = auth.uid());

drop policy if exists partner_conversions_admin_select_all on public.partner_conversions;
create policy partner_conversions_admin_select_all on public.partner_conversions
  for select using (public.is_internal_admin());

drop policy if exists partner_conversions_select_own_partner on public.partner_conversions;
create policy partner_conversions_select_own_partner on public.partner_conversions
  for select using (exists (
      select 1 from public.partner_accounts pa
      where pa.id = partner_conversions.partner_id and pa.user_id = auth.uid()
    ));

drop policy if exists partner_payouts_admin_select_all on public.partner_payouts;
create policy partner_payouts_admin_select_all on public.partner_payouts
  for select using (public.is_internal_admin());

drop policy if exists partner_payouts_select_own_partner on public.partner_payouts;
create policy partner_payouts_select_own_partner on public.partner_payouts
  for select using (exists (
      select 1 from public.partner_accounts pa
      where pa.id = partner_payouts.partner_id and pa.user_id = auth.uid()
    ));

drop policy if exists partner_commissions_admin_select_all on public.partner_commissions;
create policy partner_commissions_admin_select_all on public.partner_commissions
  for select using (public.is_internal_admin());

drop policy if exists partner_commissions_select_own_partner on public.partner_commissions;
create policy partner_commissions_select_own_partner on public.partner_commissions
  for select using (exists (
      select 1 from public.partner_accounts pa
      where pa.id = partner_commissions.partner_id and pa.user_id = auth.uid()
    ));

-- ============================================================
-- FONCTIONS
-- ============================================================

create or replace function public.partner_commission_rate_for_sale_number(p_sale_number integer)
returns numeric
language plpgsql
immutable
as $function$
begin
  if p_sale_number is null or p_sale_number < 1 then
    raise exception 'invalid_sale_number';
  end if;

  if p_sale_number <= 10 then
    return 20.00;
  elsif p_sale_number <= 30 then
    return 25.00;
  end if;

  return 30.00;
end;
$function$;

create or replace function public.partner_request_apply(
    p_display_name text,
    p_contact_name text default null::text,
    p_contact_email text default null::text,
    p_application_message text default null::text,
    p_terms_version text default 'partner_terms_v1'::text
  )
returns partner_accounts
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_partner public.partner_accounts%rowtype;
  v_auth_email text;
  v_effective_contact_email text;
  v_display_name text := nullif(btrim(p_display_name), '');
  v_contact_name text := nullif(btrim(p_contact_name), '');
  v_application_message text := nullif(btrim(p_application_message), '');
  v_terms_version text := nullif(btrim(p_terms_version), '');
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if v_display_name is null then
    raise exception 'display_name_required';
  end if;

  if v_terms_version is null then
    raise exception 'terms_version_required';
  end if;

  select lower(nullif(btrim(u.email), ''))
  into v_auth_email
  from auth.users u
  where u.id = v_uid
  limit 1;

  if v_auth_email is null then
    raise exception 'authenticated_email_required';
  end if;

  v_effective_contact_email := lower(coalesce(nullif(btrim(p_contact_email), ''), v_auth_email));

  select *
  into v_partner
  from public.partner_accounts
  where user_id = v_uid
  limit 1
  for update;

  if found then
    if v_partner.status = 'pending' then
      update public.partner_accounts
      set status = 'active',
          display_name = v_display_name,
          contact_name = coalesce(v_contact_name, contact_name),
          contact_email = v_effective_contact_email,
          application_message = v_application_message,
          terms_accepted_at = now(),
          terms_version = v_terms_version
      where id = v_partner.id
      returning *
      into v_partner;
    end if;

    return v_partner;
  end if;

  select *
  into v_partner
  from public.partner_accounts
  where user_id is null
    and contact_email = v_auth_email
  order by created_at asc
  limit 1
  for update;

  if found then
    update public.partner_accounts
    set user_id = v_uid,
        status = case when v_partner.status in ('paused', 'inactive') then v_partner.status else 'active' end,
        display_name = v_display_name,
        contact_name = coalesce(v_contact_name, contact_name),
        contact_email = v_effective_contact_email,
        application_message = coalesce(v_application_message, application_message),
        terms_accepted_at = now(),
        terms_version = v_terms_version
    where id = v_partner.id
    returning *
    into v_partner;

    return v_partner;
  end if;

  insert into public.partner_accounts (
        user_id, status, display_name, contact_name, contact_email,
        application_message, terms_accepted_at, terms_version
      )
  values (
        v_uid, 'active', v_display_name, v_contact_name, v_effective_contact_email,
        v_application_message, now(), v_terms_version
      )
  returning *
  into v_partner;

  return v_partner;
end;
$function$;

create or replace function public.partner_admin_upsert_account(
    p_partner_id uuid default null::uuid,
    p_user_id uuid default null::uuid,
    p_status text default 'pending'::text,
    p_display_name text default null::text,
    p_contact_name text default null::text,
    p_contact_email text default null::text,
    p_referral_code text default null::text,
    p_notes text default null::text
  )
returns partner_accounts
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_partner public.partner_accounts%rowtype;
begin
  if auth.role() <> 'service_role' and not public.is_internal_admin() then
    raise exception 'not_allowed';
  end if;

  if p_partner_id is null then
    insert into public.partner_accounts (
          user_id, status, display_name, contact_name, contact_email, referral_code, notes
        )
    values (
          p_user_id, coalesce(nullif(lower(btrim(p_status)), ''), 'pending'),
          p_display_name, p_contact_name, p_contact_email, p_referral_code, p_notes
        )
    returning *
    into v_partner;

    return v_partner;
  end if;

  update public.partner_accounts
  set user_id = coalesce(p_user_id, user_id),
      status = coalesce(nullif(lower(btrim(p_status)), ''), status),
      display_name = coalesce(p_display_name, display_name),
      contact_name = coalesce(p_contact_name, contact_name),
      contact_email = coalesce(p_contact_email, contact_email),
      referral_code = coalesce(p_referral_code, referral_code),
      notes = coalesce(p_notes, notes)
  where id = p_partner_id
  returning *
  into v_partner;

  if not found then
    raise exception 'partner_not_found';
  end if;

  return v_partner;
end;
$function$;

create or replace function public.partner_admin_approve_commission(p_commission_id uuid, p_notes text default null::text)
returns partner_commissions
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_commission public.partner_commissions%rowtype;
begin
  if auth.role() <> 'service_role' and not public.is_internal_admin() then
    raise exception 'not_allowed';
  end if;

  select * into v_commission from public.partner_commissions where id = p_commission_id for update;

  if not found then
    raise exception 'commission_not_found';
  end if;

  if v_commission.status = 'approved' then
    return v_commission;
  end if;

  if v_commission.status <> 'pending' then
    raise exception 'commission_not_pending';
  end if;

  update public.partner_commissions
  set status = 'approved',
      approved_at = now(),
      approved_by_user_id = coalesce(auth.uid(), approved_by_user_id),
      notes = coalesce(p_notes, notes)
  where id = p_commission_id
  returning * into v_commission;

  return v_commission;
end;
$function$;

create or replace function public.partner_admin_void_commission(p_commission_id uuid, p_notes text default null::text)
returns partner_commissions
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_commission public.partner_commissions%rowtype;
begin
  if auth.role() <> 'service_role' and not public.is_internal_admin() then
    raise exception 'not_allowed';
  end if;

  select * into v_commission from public.partner_commissions where id = p_commission_id for update;

  if not found then
    raise exception 'commission_not_found';
  end if;

  if v_commission.status = 'voided' then
    return v_commission;
  end if;

  if v_commission.status = 'paid' then
    raise exception 'paid_commission_cannot_be_voided';
  end if;

  if v_commission.payout_id is not null then
    raise exception 'commission_attached_to_payout';
  end if;

  update public.partner_commissions
  set status = 'voided', notes = coalesce(p_notes, notes)
  where id = p_commission_id
  returning * into v_commission;

  return v_commission;
end;
$function$;

create or replace function public.partner_admin_create_payout(
    p_partner_id uuid,
    p_currency text,
    p_payment_method text default null::text,
    p_payment_reference text default null::text,
    p_notes text default null::text
  )
returns partner_payouts
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_payout public.partner_payouts%rowtype;
begin
  if auth.role() <> 'service_role' and not public.is_internal_admin() then
    raise exception 'not_allowed';
  end if;

  if not exists (select 1 from public.partner_accounts pa where pa.id = p_partner_id) then
    raise exception 'partner_not_found';
  end if;

  insert into public.partner_payouts (
        partner_id, status, currency, amount_minor, payment_method, payment_reference, notes, created_by_user_id
      )
  values (
        p_partner_id, 'draft', upper(nullif(btrim(p_currency), '')), 0,
        p_payment_method, p_payment_reference, p_notes, auth.uid()
      )
  returning * into v_payout;

  return v_payout;
end;
$function$;

create or replace function public.partner_admin_attach_commissions_to_payout(p_payout_id uuid, p_commission_ids uuid[])
returns table(payout_id uuid, attached_commission_count integer, payout_amount_minor integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_payout public.partner_payouts%rowtype;
  v_requested_count integer;
  v_selected_count integer;
begin
  if auth.role() <> 'service_role' and not public.is_internal_admin() then
    raise exception 'not_allowed';
  end if;

  if coalesce(array_length(p_commission_ids, 1), 0) = 0 then
    raise exception 'commission_ids_required';
  end if;

  select * into v_payout from public.partner_payouts where id = p_payout_id for update;

  if not found then
    raise exception 'payout_not_found';
  end if;

  if v_payout.status not in ('draft', 'approved') then
    raise exception 'payout_not_attachable';
  end if;

  select count(*) into v_requested_count from (select distinct unnest(p_commission_ids) as commission_id) x;

  select count(*) into v_selected_count
  from public.partner_commissions pc
  where pc.id = any(p_commission_ids)
    and pc.partner_id = v_payout.partner_id
    and pc.currency = v_payout.currency
    and pc.status = 'approved'
    and (pc.payout_id is null or pc.payout_id = v_payout.id);

  if v_selected_count <> v_requested_count then
    raise exception 'invalid_commission_selection_for_payout';
  end if;

  update public.partner_commissions
  set payout_id = v_payout.id
  where id = any(p_commission_ids)
    and status = 'approved'
    and (payout_id is null or payout_id = v_payout.id);

  select count(*) into v_selected_count
  from public.partner_commissions pc
  where pc.id = any(p_commission_ids) and pc.payout_id = v_payout.id;

  if v_selected_count <> v_requested_count then
    raise exception 'commission_attachment_conflict';
  end if;

  update public.partner_payouts pp
  set amount_minor = coalesce((
            select sum(pc.commission_amount_minor)::int
            from public.partner_commissions pc
            where pc.payout_id = pp.id
          ), 0),
      status = 'approved',
      approved_at = coalesce(pp.approved_at, now())
  where pp.id = v_payout.id
  returning pp.id, (
        select count(*)::int from public.partner_commissions pc where pc.payout_id = pp.id
      ), pp.amount_minor
  into payout_id, attached_commission_count, payout_amount_minor;

  return next;
end;
$function$;

create or replace function public.partner_admin_mark_payout_paid(
    p_payout_id uuid,
    p_payment_reference text default null::text,
    p_notes text default null::text
  )
returns partner_payouts
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_payout public.partner_payouts%rowtype;
  v_paid_at timestamptz := now();
begin
  if auth.role() <> 'service_role' and not public.is_internal_admin() then
    raise exception 'not_allowed';
  end if;

  select * into v_payout from public.partner_payouts where id = p_payout_id for update;

  if not found then
    raise exception 'payout_not_found';
  end if;

  if v_payout.status = 'paid' then
    return v_payout;
  end if;

  if v_payout.status <> 'approved' then
    raise exception 'payout_not_approved';
  end if;

  if not exists (
        select 1 from public.partner_commissions pc
        where pc.payout_id = v_payout.id and pc.status = 'approved'
      ) then
    raise exception 'payout_has_no_approved_commissions';
  end if;

  update public.partner_payouts
  set status = 'paid',
      payment_reference = coalesce(nullif(btrim(p_payment_reference), ''), payment_reference),
      notes = coalesce(p_notes, notes),
      paid_at = v_paid_at,
      paid_by_user_id = coalesce(auth.uid(), paid_by_user_id)
  where id = p_payout_id
  returning * into v_payout;

  update public.partner_commissions
  set status = 'paid', paid_at = v_paid_at
  where payout_id = v_payout.id and status = 'approved';

  return v_payout;
end;
$function$;

create or replace function public.process_partner_conversion_from_payment(
    p_billing_payment_id uuid,
    p_partner_id uuid default null::uuid,
    p_referral_code text default null::text,
    p_attribution_method text default 'referral_code'::text,
    p_metadata jsonb default '{}'::jsonb
  )
returns table(conversion_id uuid, commission_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_payment public.billing_payments%rowtype;
  v_partner public.partner_accounts%rowtype;
  v_conversion public.partner_conversions%rowtype;
  v_commission public.partner_commissions%rowtype;
  v_first_payment_id uuid;
  v_is_first_paid boolean;
  v_sale_sequence_number integer;
  v_rate numeric(5,2);
  v_normalized_referral_code text;
  v_effective_referral_code text;
begin
  if auth.role() <> 'service_role' and not public.is_internal_admin() then
    raise exception 'not_allowed';
  end if;

  if p_partner_id is null and coalesce(btrim(p_referral_code), '') = '' then
    raise exception 'partner_identifier_required';
  end if;

  select * into v_payment from public.billing_payments where id = p_billing_payment_id for update;

  if not found then
    raise exception 'billing_payment_not_found';
  end if;

  if v_payment.status not in ('paid', 'paid_test') then
    raise exception 'billing_payment_not_paid';
  end if;

  v_normalized_referral_code := upper(regexp_replace(coalesce(p_referral_code, ''), '[^A-Za-z0-9]+', '', 'g'));

  if p_partner_id is not null then
    select * into v_partner from public.partner_accounts
    where id = p_partner_id and status = 'active' for update;
  else
    select * into v_partner from public.partner_accounts
    where referral_code = v_normalized_referral_code and status = 'active' for update;
  end if;

  if not found then
    raise exception 'partner_not_active';
  end if;

  v_effective_referral_code := coalesce(nullif(v_normalized_referral_code, ''), v_partner.referral_code);

  select * into v_conversion from public.partner_conversions where billing_payment_id = v_payment.id limit 1;

  if found then
    if v_conversion.partner_id <> v_partner.id then
      raise exception 'billing_payment_already_attributed_to_another_partner';
    end if;

    select * into v_commission from public.partner_commissions where conversion_id = v_conversion.id limit 1;

    if not found and v_conversion.is_first_paid_subscription = true and v_conversion.status = 'attributed' then
      select count(*) + 1 into v_sale_sequence_number
      from public.partner_conversions pc
      where pc.partner_id = v_conversion.partner_id
        and pc.is_first_paid_subscription = true
        and pc.status = 'attributed'
        and (pc.converted_at < v_conversion.converted_at
                   or (pc.converted_at = v_conversion.converted_at and pc.id::text < v_conversion.id::text));

      v_rate := public.partner_commission_rate_for_sale_number(v_sale_sequence_number);

      insert into public.partner_commissions (
                partner_id, conversion_id, billing_payment_id, status, currency,
                commissionable_amount_minor, commission_rate_percent, commission_amount_minor,
                sale_sequence_number, calculated_at
              )
      values (
                v_conversion.partner_id, v_conversion.id, v_conversion.billing_payment_id, 'pending',
                upper(v_payment.currency), v_payment.amount_minor, v_rate,
                round(v_payment.amount_minor::numeric * (v_rate / 100.0))::int,
                v_sale_sequence_number, now()
              )
      returning * into v_commission;
    end if;

    conversion_id := v_conversion.id;
    commission_id := v_commission.id;
    return next;
    return;
  end if;

  select bp.id into v_first_payment_id
  from public.billing_payments bp
  where bp.user_id = v_payment.user_id and bp.status in ('paid', 'paid_test')
  order by coalesce(bp.paid_at, bp.created_at), bp.created_at, bp.id
  limit 1;

  v_is_first_paid := (v_first_payment_id = v_payment.id);

  insert into public.partner_conversions (
        partner_id, billing_payment_id, customer_user_id, billing_plan_id,
        referral_code_used, attribution_method, status, is_first_paid_subscription,
        disqualification_reason, converted_at, metadata
      )
  values (
        v_partner.id, v_payment.id, v_payment.user_id, v_payment.plan_id,
        v_effective_referral_code, coalesce(nullif(lower(btrim(p_attribution_method)), ''), 'referral_code'),
        case when v_is_first_paid then 'attributed' else 'disqualified' end,
        v_is_first_paid,
        case when v_is_first_paid then null else 'not_first_paid_subscription' end,
        coalesce(v_payment.paid_at, now()), coalesce(p_metadata, '{}'::jsonb)
      )
  returning * into v_conversion;

  if v_conversion.is_first_paid_subscription = true and v_conversion.status = 'attributed' then
    select count(*) + 1 into v_sale_sequence_number
    from public.partner_conversions pc
    where pc.partner_id = v_conversion.partner_id
      and pc.is_first_paid_subscription = true
      and pc.status = 'attributed'
      and (pc.converted_at < v_conversion.converted_at
               or (pc.converted_at = v_conversion.converted_at and pc.id::text < v_conversion.id::text));

    v_rate := public.partner_commission_rate_for_sale_number(v_sale_sequence_number);

    insert into public.partner_commissions (
            partner_id, conversion_id, billing_payment_id, status, currency,
            commissionable_amount_minor, commission_rate_percent, commission_amount_minor,
            sale_sequence_number, calculated_at
          )
    values (
            v_conversion.partner_id, v_conversion.id, v_conversion.billing_payment_id, 'pending',
            upper(v_payment.currency), v_payment.amount_minor, v_rate,
            round(v_payment.amount_minor::numeric * (v_rate / 100.0))::int,
            v_sale_sequence_number, now()
          )
    returning * into v_commission;
  end if;

  conversion_id := v_conversion.id;
  commission_id := v_commission.id;
  return next;
end;
$function$;
