-- Tute dispatch: tell people when their step of a round opens. Safe to run twice.
--   * Round finalised          → Courier people: add the tracking numbers.
--   * First tracking numbers    → Packers: packing can start.
--   * Every parcel ready        → Verify people: hand over to Citypak
--                                 (or planners: close the round, when Handover is off).
-- One message per round and step (dedupe key), never to the person who did it.

-- Active people with this dispatch permission (same rules as has_dispatch, for anyone).
create or replace function public.dispatch_people_with(p_cap text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles p
  where p.is_active
    and (
      (p.is_admin and p.is_main_admin)
      or (
        coalesce(p.page_access ->> 'dispatch', case when p.is_admin then 'edit' end) = 'edit'
        and (
          (p.is_admin and p_cap in ('plan', 'courier', 'pack', 'verify'))
          or exists (select 1 from public.dispatch_grants g
                     where g.user_id = p.id and g.capability = p_cap and g.revoked_at is null)
        )
      )
    );
$$;

create or replace function public.dispatch_notify_cap(
  p_cap text, p_title text, p_body text, p_link text, p_dedupe text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid;
begin
  for who in select * from public.dispatch_people_with(p_cap) loop
    if who is distinct from (select auth.uid()) then
      perform public.notify(who, 'dispatch.turn', p_title, p_body, p_link, p_dedupe || ':' || who::text);
    end if;
  end loop;
end;
$$;

-- Round finalised → tracking numbers.
create or replace function public.notify_dispatch_round()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.state = 'draft' and new.state = 'finalised' then
    perform public.dispatch_notify_cap('courier', 'Add tracking numbers: ' || new.name,
      'The round is ready. Upload the Citypak file to get the tracking numbers.',
      '/admin/dispatch/rounds/' || new.id::text || '/courier', 'dispatch-tracking:' || new.id::text);
  end if;
  return null;
end;
$$;

create or replace trigger dispatch_rounds_notify
  after update of state on public.dispatch_rounds
  for each row execute function public.notify_dispatch_round();

-- Parcels changed → packing open, or everything ready.
create or replace function public.notify_dispatch_parcels()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  verification boolean := coalesce((select require_verification from public.dispatch_settings limit 1), false);
  handover boolean := coalesce((select 'handover' = any (optional_steps) from public.dispatch_settings limit 1), true);
  waiting integer;
begin
  for r in
    select n.round_id,
           bool_or(n.registration_state = 'registered' and o.registration_state <> 'registered') as registered,
           bool_or(n.pack_state is distinct from o.pack_state) as packed
    from new_rows n join old_rows o on o.id = n.id
    group by n.round_id
  loop
    if r.registered then
      perform public.dispatch_notify_cap('pack', 'Packing can start: ' || dr.name,
        'Tracking numbers are in. Open the packing station to start.',
        '/admin/dispatch/rounds/' || dr.id::text || '/scan', 'dispatch-pack:' || dr.id::text)
      from public.dispatch_rounds dr where dr.id = r.round_id and dr.state in ('finalised', 'active');
    end if;
    if r.packed then
      select count(*) into waiting
      from public.parcels p
      where p.round_id = r.round_id and p.registration_state <> 'voided'
        and case when verification then p.pack_state <> 'verified' else p.pack_state = 'planned' end;
      if waiting = 0 then
        if handover then
          perform public.dispatch_notify_cap('verify', 'Ready for Citypak: ' || dr.name,
            'Every parcel is packed and checked. Start the handover when the courier comes.',
            '/admin/dispatch/rounds/' || dr.id::text || '/handover', 'dispatch-handover:' || dr.id::text)
          from public.dispatch_rounds dr where dr.id = r.round_id and dr.state in ('finalised', 'active');
        else
          perform public.dispatch_notify_cap('plan', 'All packed: ' || dr.name,
            'Every parcel is packed. You can close the round when they have gone.',
            '/admin/dispatch/rounds/' || dr.id::text, 'dispatch-packed:' || dr.id::text)
          from public.dispatch_rounds dr where dr.id = r.round_id and dr.state in ('finalised', 'active');
        end if;
      end if;
    end if;
  end loop;
  return null;
end;
$$;

create or replace trigger parcels_notify_turn
  after update on public.parcels
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.notify_dispatch_parcels();

revoke all on function public.dispatch_people_with(text) from public, anon, authenticated;
revoke all on function public.dispatch_notify_cap(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.notify_dispatch_round() from public, anon, authenticated;
revoke all on function public.notify_dispatch_parcels() from public, anon, authenticated;
