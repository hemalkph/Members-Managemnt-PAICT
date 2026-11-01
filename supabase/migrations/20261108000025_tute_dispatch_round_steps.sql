-- =============================================================================
-- Tute dispatch: choose which round steps the office uses. Safe to run more than once.
--
-- Plan, Tracking numbers, Pack and Close are always used. Handover, Delivery
-- and COD money are optional (dispatch_settings.optional_steps). Delivery
-- needs Handover and COD money needs Delivery. Closing a round only waits for
-- the steps that are switched on, e.g. Plan → Tracking → Pack → Close closes
-- once every parcel is packed (and verified when verification is on).
-- Only main admins can change the steps, like verification.
-- =============================================================================

alter table public.dispatch_settings add column if not exists optional_steps text[] not null
  default array['handover', 'delivery', 'money']
  check (optional_steps <@ array['handover', 'delivery', 'money']);

create or replace function public.dispatch_settings_save(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur public.dispatch_settings;
  steps text[];
begin
  if not public.has_dispatch('plan') then
    raise exception 'You are not allowed to change dispatch settings.' using errcode = '42501';
  end if;
  select * into cur from public.dispatch_settings where id for update;

  -- Optional steps depend on each other: Delivery needs Handover, COD money needs Delivery.
  steps := cur.optional_steps;
  if p ? 'optional_steps' then
    steps := array(select x #>> '{}' from jsonb_array_elements(p -> 'optional_steps') as x);
    if not 'handover' = any (steps) then steps := array_remove(steps, 'delivery'); end if;
    if not 'delivery' = any (steps) then steps := array_remove(steps, 'money'); end if;
    steps := array(select k from unnest(array['handover', 'delivery', 'money']) as k where k = any (steps));
  end if;

  if ((p ? 'require_verification') and (p ->> 'require_verification')::boolean is distinct from cur.require_verification)
     or steps is distinct from cur.optional_steps
     or ((p ? 'allow_self_verify') and (p ->> 'allow_self_verify')::boolean is distinct from cur.allow_self_verify)
     or ((p ? 'student_retention_months') and (p ->> 'student_retention_months')::integer is distinct from cur.student_retention_months)
     or ((p ? 'recipient_retention_days') and (p ->> 'recipient_retention_days')::integer is distinct from cur.recipient_retention_days)
     or ((p ? 'courier_file_retention_days') and (p ->> 'courier_file_retention_days')::integer is distinct from cur.courier_file_retention_days)
     or ((p ? 'import_file_retention_days') and (p ->> 'import_file_retention_days')::integer is distinct from cur.import_file_retention_days) then
    if not public.is_main_admin() then
      raise exception 'Only main admins can change verification or retention.' using errcode = '42501';
    end if;
  end if;

  update public.dispatch_settings set
    sender_name                 = coalesce(trim(p ->> 'sender_name'), sender_name),
    sender_line1                = coalesce(trim(p ->> 'sender_line1'), sender_line1),
    sender_line2                = coalesce(trim(p ->> 'sender_line2'), sender_line2),
    sender_line3                = coalesce(trim(p ->> 'sender_line3'), sender_line3),
    sender_city                 = coalesce(trim(p ->> 'sender_city'), sender_city),
    sender_contact_name         = coalesce(trim(p ->> 'sender_contact_name'), sender_contact_name),
    sender_phone1               = coalesce(trim(p ->> 'sender_phone1'), sender_phone1),
    sender_phone2               = coalesce(trim(p ->> 'sender_phone2'), sender_phone2),
    default_cod                 = coalesce((p ->> 'default_cod')::numeric, default_cod),
    default_weight_g            = coalesce((p ->> 'default_weight_g')::integer, default_weight_g),
    default_pieces              = coalesce((p ->> 'default_pieces')::integer, default_pieces),
    require_verification        = coalesce((p ->> 'require_verification')::boolean, require_verification),
    allow_self_verify           = coalesce((p ->> 'allow_self_verify')::boolean, allow_self_verify),
    optional_steps              = steps,
    student_retention_months    = coalesce((p ->> 'student_retention_months')::integer, student_retention_months),
    recipient_retention_days    = coalesce((p ->> 'recipient_retention_days')::integer, recipient_retention_days),
    courier_file_retention_days = coalesce((p ->> 'courier_file_retention_days')::integer, courier_file_retention_days),
    import_file_retention_days  = coalesce((p ->> 'import_file_retention_days')::integer, import_file_retention_days),
    updated_by = (select auth.uid()),
    updated_at = now()
  where id;

  perform public.write_activity('dispatch.settings_saved', 'dispatch', null, null,
    'Changed the tute dispatch settings', '{}'::jsonb);
end;
$$;

create or replace function public.round_close_check(p_round uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.dispatch_rounds;
  t jsonb;
  blockers jsonb := '[]'::jsonb;
  st public.dispatch_settings;
  not_ready integer;
  not_out integer;
begin
  if not public.has_page('dispatch') then
    raise exception 'You are not allowed to see this round.' using errcode = '42501';
  end if;
  select * into r from public.dispatch_rounds where id = p_round;
  if r.id is null then
    raise exception 'Round not found.' using errcode = 'P0001';
  end if;
  select * into st from public.dispatch_settings limit 1;
  t := public.dispatch_round_totals(p_round);
  if r.state not in ('finalised', 'active') then
    blockers := blockers || to_jsonb('The round is ' || r.state || '.');
  end if;
  if (t ->> 'open_handover')::boolean then
    blockers := blockers || to_jsonb('A handover is still open – confirm or cancel it.'::text);
  end if;

  if 'delivery' = any (st.optional_steps) then
    if (t ->> 'unresolved')::integer > 0 then
      blockers := blockers || to_jsonb((t ->> 'unresolved') || ' parcel(s) are not delivered or returned – update them, or void them.');
    end if;
  elsif 'handover' = any (st.optional_steps) then
    not_out := (t ->> 'live')::integer - (t ->> 'handed_over')::integer;
    if not_out > 0 then
      blockers := blockers || to_jsonb(not_out || ' parcel(s) are not handed over yet – hand them over, or void them.');
    end if;
  else
    select count(*) into not_ready from public.parcels
     where round_id = p_round and registration_state <> 'voided'
       and (pack_state = 'planned' or (st.require_verification and pack_state <> 'verified') or on_hold);
    if not_ready > 0 then
      blockers := blockers || to_jsonb(not_ready || ' parcel(s) are not packed yet – pack them, or void them.');
    end if;
  end if;

  if 'money' = any (st.optional_steps) then
    if (t ->> 'in_draft')::integer > 0 then
      blockers := blockers || to_jsonb((t ->> 'in_draft') || ' parcel(s) are in a draft settlement – confirm or cancel it.');
    end if;
    if (t ->> 'owing_parcels')::integer > 0 then
      blockers := blockers || to_jsonb((t ->> 'owing_parcels') || ' delivered parcel(s) still owe COD (Rs. ' || (t ->> 'cod_outstanding')
                                       || ') – record the settlement, or write the shortfall off.');
    end if;
  end if;
  return t || jsonb_build_object('state', r.state, 'blockers', blockers, 'can_close', jsonb_array_length(blockers) = 0,
                                 'closed_at', r.closed_at, 'closed_name', public.dispatch_name(r.closed_by), 'close_note', r.close_note,
                                 'steps', to_jsonb(st.optional_steps));
end;
$$;
