-- =============================================================================
-- Tute dispatch: delete student details from the app. Safe to run more than once.
--
--   student_delete(student)           planners. Only a student who is in no
--                                     parcel (taken out of draft rounds first).
--   dispatch_batch_clear(batch, name) main admins, typing the batch name.
--       * batch name starting with TEST: everything of the batch goes –
--         students, rounds, parcels and their history, handovers, settlements
--         that only cover its parcels, courier files and import records.
--       * any other batch: its students and import records, only while the
--         batch has no sent round (finalised, active or closed). Real delivery
--         and COD records are never deleted; their personal details are
--         removed by the nightly retention instead.
-- Returns the storage paths of files to remove, which the server then deletes.
-- =============================================================================

-- Parcel history stays append-only, except inside dispatch_batch_clear for a
-- TEST batch (it sets dispatch.purge for its own transaction only).
create or replace function public.parcel_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and current_setting('dispatch.purge', true) = 'on' then
    return old;
  end if;
  raise exception 'Parcel history cannot be changed or deleted.' using errcode = '42501';
end;
$$;
revoke all on function public.parcel_events_append_only() from public, anon, authenticated;

create or replace function public.student_delete(p_student uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.dispatch_require('plan');
  s public.students;
begin
  select * into s from public.students where id = p_student for update;
  if s.id is null then
    raise exception 'Student not found.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.parcels where student_id = s.id) then
    raise exception 'This student is in a sent round, so the delivery record must stay. Mark them inactive instead – their details are removed automatically later.'
      using errcode = 'P0001';
  end if;
  delete from public.round_students where student_id = s.id;
  delete from public.students where id = s.id;
  perform public.write_activity('dispatch.student_deleted', 'dispatch', s.id::text, null,
    'Deleted a student from the delivery register', jsonb_build_object('batch_id', s.batch_id));
end;
$$;

create or replace function public.dispatch_batch_clear(p_batch uuid, p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.batches;
  test boolean;
  n_students integer;
  n_rounds integer := 0;
  n_parcels integer := 0;
  n_settlements integer := 0;
  paths text[];
  file_ids uuid[];
begin
  if not public.is_main_admin() then
    raise exception 'Only main admins can clear a batch.' using errcode = '42501';
  end if;
  select * into b from public.batches where id = p_batch for update;
  if b.id is null then
    raise exception 'Batch not found.' using errcode = 'P0001';
  end if;
  if trim(coalesce(p_confirm, '')) <> b.name then
    raise exception 'Type the batch name exactly to confirm.' using errcode = 'P0001';
  end if;
  test := b.name ~* '^test';

  if not test and exists (select 1 from public.dispatch_rounds where batch_id = b.id and state in ('finalised', 'active', 'closed')) then
    raise exception 'This batch has sent rounds, so its delivery records must stay. Student details are removed automatically after the last round closes (Dispatch settings → retention).'
      using errcode = 'P0001';
  end if;

  -- Files to delete from storage afterwards.
  select coalesce(array_agg(path), '{}') into paths from (
    select storage_path as path from public.student_imports
     where batch_id = b.id and storage_path is not null and file_deleted_at is null
    union all
    select f.storage_path from public.carrier_files f join public.dispatch_rounds r on r.id = f.round_id
     where r.batch_id = b.id and f.deleted_at is null
  ) x;

  if test then
    if exists (select 1 from public.cod_settlement_lines l join public.parcels p on p.id = l.parcel_id
                join public.dispatch_rounds r on r.id = p.round_id
                join public.cod_settlement_lines o on o.settlement_id = l.settlement_id
                join public.parcels op on op.id = o.parcel_id
                join public.dispatch_rounds orr on orr.id = op.round_id
               where r.batch_id = b.id and orr.batch_id <> b.id) then
      raise exception 'A COD settlement mixes this test batch with real parcels. Remove the test parcels from it first.' using errcode = 'P0001';
    end if;
    select coalesce(array_agg(f.storage_path), '{}') || paths into paths
      from public.cod_settlements s join public.carrier_files f on f.id = s.file_id
     where s.id in (select l.settlement_id from public.cod_settlement_lines l join public.parcels p on p.id = l.parcel_id
                     join public.dispatch_rounds r on r.id = p.round_id where r.batch_id = b.id);
    select coalesce(array_agg(file_id) filter (where file_id is not null), '{}'), count(*) into file_ids, n_settlements
      from public.cod_settlements
     where id in (select l.settlement_id from public.cod_settlement_lines l join public.parcels p on p.id = l.parcel_id
                   join public.dispatch_rounds r on r.id = p.round_id where r.batch_id = b.id);
    delete from public.cod_settlements
     where id in (select l.settlement_id from public.cod_settlement_lines l join public.parcels p on p.id = l.parcel_id
                   join public.dispatch_rounds r on r.id = p.round_id where r.batch_id = b.id);
    delete from public.carrier_files where id = any (file_ids);

    perform set_config('dispatch.purge', 'on', true);
    delete from public.parcel_scans where round_id in (select id from public.dispatch_rounds where batch_id = b.id);
    delete from public.parcel_events where round_id in (select id from public.dispatch_rounds where batch_id = b.id);
    perform set_config('dispatch.purge', 'off', true);
    update public.parcels set replaces_parcel_id = null, handover_id = null
     where round_id in (select id from public.dispatch_rounds where batch_id = b.id);
    delete from public.handovers where round_id in (select id from public.dispatch_rounds where batch_id = b.id);
    delete from public.carrier_files where round_id in (select id from public.dispatch_rounds where batch_id = b.id);
    with gone as (
      delete from public.parcels where round_id in (select id from public.dispatch_rounds where batch_id = b.id) returning 1
    ) select count(*) into n_parcels from gone;
  end if;

  -- Draft and cancelled rounds hold no parcels; a test batch's rounds are empty by now.
  with gone as (delete from public.dispatch_rounds where batch_id = b.id returning 1)
  select count(*) into n_rounds from gone;
  with gone as (delete from public.students where batch_id = b.id returning 1)
  select count(*) into n_students from gone;
  delete from public.student_imports where batch_id = b.id;

  perform public.write_activity('dispatch.batch_cleared', 'dispatch', b.id::text, null,
    'Cleared dispatch data of batch ' || b.name,
    jsonb_build_object('students', n_students, 'rounds', n_rounds, 'parcels', n_parcels, 'test', test));
  return jsonb_build_object('students', n_students, 'rounds', n_rounds, 'parcels', n_parcels,
                            'settlements', n_settlements, 'test', test, 'files', to_jsonb(paths));
end;
$$;

revoke all on function public.student_delete(uuid) from public, anon, authenticated;
revoke all on function public.dispatch_batch_clear(uuid, text) from public, anon, authenticated;
grant execute on function public.student_delete(uuid) to authenticated;
grant execute on function public.dispatch_batch_clear(uuid, text) to authenticated;
