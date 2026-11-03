-- Packing station. Safe to run twice.
--   1. A packer can undo a parcel they packed in the last 2 minutes (a wrong
--      tap). Older or verified parcels still need a planner's correction.
--   2. The round's team: who packed / verified how many, and when last.

create or replace function public.parcel_undo_pack(p_parcel uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.dispatch_require('pack');
  par public.parcels;
begin
  select * into par from public.parcels where id = p_parcel for update;
  if par.id is null or par.pack_state <> 'packed' or par.packed_by is distinct from actor then
    raise exception 'Only a parcel you just packed can be undone.' using errcode = 'P0001';
  end if;
  if par.packed_at < now() - interval '2 minutes' then
    raise exception 'Too late to undo. Ask a planner to correct it.' using errcode = 'P0001';
  end if;
  if par.delivery_state <> 'awaiting_pickup' then
    raise exception 'Already handed to the courier.' using errcode = 'P0001';
  end if;
  update public.parcels
     set pack_state = 'planned', packed_by = null, packed_at = null,
         row_version = row_version + 1, updated_at = now()
   where id = par.id;
  insert into public.parcel_events (parcel_id, round_id, type, from_state, to_state, actor, source, reason)
  values (par.id, par.round_id, 'unpacked', 'packed', 'planned', actor, 'scan', 'Undone at the packing station');
end;
$$;

create or replace function public.dispatch_round_team(p_round uuid)
returns table (id uuid, name text, packed integer, verified integer, last_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with work as (
    select packed_by as who, 1 as p, 0 as v, packed_at as at
      from public.parcels where round_id = p_round and packed_by is not null
    union all
    select verified_by, 0, 1, verified_at
      from public.parcels where round_id = p_round and verified_by is not null
  )
  select w.who, public.dispatch_name(w.who), sum(w.p)::integer, sum(w.v)::integer, max(w.at)
  from work w
  where public.has_dispatch('pack') or public.has_dispatch('verify') or public.has_dispatch('plan')
  group by w.who
  order by max(w.at) desc;
$$;

revoke all on function public.parcel_undo_pack(uuid) from public, anon, authenticated;
revoke all on function public.dispatch_round_team(uuid) from public, anon, authenticated;
grant execute on function public.parcel_undo_pack(uuid) to authenticated;
grant execute on function public.dispatch_round_team(uuid) to authenticated;
