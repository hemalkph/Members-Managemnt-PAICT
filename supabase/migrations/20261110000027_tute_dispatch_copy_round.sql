-- =============================================================================
-- Tute dispatch: start a new round as a copy of an earlier one. Safe to run more than once.
--
-- The new draft gets the details passed in (name, month, a new reference
-- prefix…) but always keeps the earlier round's batch. It copies the tutes
-- (including extra tutes) and the students with their COD, note and which
-- tutes they get. Students no longer active in the batch are left out.
-- A tute from Papers that is no longer finished is copied as a typed-in title.
-- =============================================================================

create or replace function public.round_copy(p_from uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.dispatch_require('plan');
  src public.dispatch_rounds;
  rid uuid;
  t record;
  tid uuid;
  id_map jsonb := '{}'::jsonb;
  copied integer;
  skipped integer;
begin
  select * into src from public.dispatch_rounds where id = p_from;
  if src.id is null then
    raise exception 'Round not found.' using errcode = 'P0001';
  end if;

  rid := public.round_save((p - 'id') || jsonb_build_object('batch_id', src.batch_id));

  for t in select * from public.round_tutes where round_id = p_from order by sort_order loop
    insert into public.round_tutes (round_id, paper_id, manual_title, title, short_code, version_label, qty_per_parcel, is_extra, sort_order)
    select rid, pp.id, case when pp.id is null then t.title end, coalesce(pp.title, t.title), t.short_code, t.version_label,
           t.qty_per_parcel, t.is_extra, t.sort_order
      from (select 1) one
      left join public.papers pp on pp.id = t.paper_id and pp.kind = 'tute' and pp.status = 'done'
    returning id into tid;
    id_map := id_map || jsonb_build_object(t.id::text, tid);
  end loop;

  insert into public.round_students (round_id, student_id, cod_amount, note, excluded_tute_ids, extra_tute_ids)
  select rid, rs.student_id, rs.cod_amount, rs.note,
         array(select (id_map ->> x::text)::uuid from unnest(rs.excluded_tute_ids) x where id_map ? x::text),
         array(select (id_map ->> x::text)::uuid from unnest(rs.extra_tute_ids) x where id_map ? x::text)
    from public.round_students rs
    join public.students s on s.id = rs.student_id
   where rs.round_id = p_from and s.batch_id = src.batch_id and s.is_active and s.anonymised_at is null;
  get diagnostics copied = row_count;
  select count(*) - copied into skipped from public.round_students where round_id = p_from;

  perform public.write_activity('dispatch.round_copied', 'dispatch', rid::text, null,
    'Started a round as a copy of ' || src.name, jsonb_build_object('round_id', rid, 'from', p_from, 'students', copied));
  return jsonb_build_object('id', rid, 'tutes', (select count(*) from public.round_tutes where round_id = rid),
                            'students', copied, 'skipped', skipped);
end;
$$;

revoke all on function public.round_copy(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.round_copy(uuid, jsonb) to authenticated;
