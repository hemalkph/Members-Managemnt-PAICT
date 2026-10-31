-- =============================================================================
-- Delete ALL tute-dispatch test data of ONE batch (students, rounds, parcels,
-- handovers, settlements, history). For test batches only – including tests
-- run with real student data before going live.
--
-- How to use (Supabase SQL Editor):
--   1. Change the batch name on the line marked  <<< BATCH NAME  below.
--      It must start with "TEST" (a safety check).
--   2. Run it. It prints how much it deleted, then lists the stored files
--      that you delete by hand in Storage → dispatch (folders named in the list).
--   3. Optional: delete the batch itself on the Batches page if nothing else uses it.
--
-- Everything runs in one transaction: if anything fails, nothing is deleted.
-- =============================================================================
begin;

create temp table _test_batch on commit drop as
select id, name from public.batches where name = 'TEST Dispatch';   -- <<< BATCH NAME

do $$
declare
  b record;
  n_rounds integer; n_parcels integer; n_students integer; n_settlements integer;
begin
  select * into b from _test_batch;
  if b.id is null then
    raise exception 'No batch with that name.';
  end if;
  if b.name !~* '^test' then
    raise exception 'Safety stop: the batch name must start with TEST.';
  end if;
  if exists (select 1 from public.dispatch_rounds r join public.parcels p on p.round_id = r.id
              join public.cod_settlement_lines l on l.parcel_id = p.id
              join public.cod_settlement_lines o on o.settlement_id = l.settlement_id
              join public.parcels op on op.id = o.parcel_id
              join public.dispatch_rounds orr on orr.id = op.round_id
             where r.batch_id = b.id and orr.batch_id <> b.id) then
    raise exception 'Safety stop: a settlement mixes test parcels with real ones. Remove the test parcels from it first.';
  end if;

  create temp table _rounds on commit drop as select id from public.dispatch_rounds where batch_id = b.id;
  create temp table _parcels on commit drop as select id from public.parcels where round_id in (select id from _rounds);
  select count(*) into n_rounds from _rounds;
  select count(*) into n_parcels from _parcels;

  -- Settlements that only cover test parcels.
  create temp table _settlements on commit drop as
    select distinct settlement_id as id from public.cod_settlement_lines where parcel_id in (select id from _parcels);
  n_settlements := (select count(*) from _settlements);

  -- Files to delete by hand afterwards.
  create temp table _files on commit drop as
    select storage_path from public.carrier_files where round_id in (select id from _rounds)
    union all
    select f.storage_path from public.carrier_files f join public.cod_settlements s on s.file_id = f.id where s.id in (select id from _settlements)
    union all
    select storage_path from public.student_imports where batch_id = b.id and storage_path is not null and file_deleted_at is null;

  delete from public.cod_settlements where id in (select id from _settlements);  -- lines go with them
  delete from public.carrier_files f where f.kind = 'settlement_report'
     and not exists (select 1 from public.cod_settlements s where s.file_id = f.id)
     and f.storage_path in (select storage_path from _files);

  delete from public.parcel_scans where round_id in (select id from _rounds);
  -- Parcel history is append-only; allow deleting it for these rounds only.
  alter table public.parcel_events disable trigger parcel_events_no_update;
  delete from public.parcel_events where round_id in (select id from _rounds);
  alter table public.parcel_events enable trigger parcel_events_no_update;

  update public.parcels set replaces_parcel_id = null, handover_id = null where id in (select id from _parcels);
  delete from public.handovers where round_id in (select id from _rounds);        -- handover parcels go with them
  delete from public.carrier_files where round_id in (select id from _rounds);
  delete from public.parcels where id in (select id from _parcels);              -- recipients, items, problems, scans go with them
  delete from public.dispatch_rounds where id in (select id from _rounds);       -- tutes and round students go with them

  select count(*) into n_students from public.students where batch_id = b.id;
  delete from public.students where batch_id = b.id;
  delete from public.student_imports where batch_id = b.id;

  raise notice 'Deleted % round(s), % parcel(s), % student(s), % settlement(s) of batch "%".',
    n_rounds, n_parcels, n_students, n_settlements, b.name;
end;
$$;

-- Files to delete by hand in Storage → dispatch (the folder is the second part of each path).
select storage_path as delete_this_file_in_storage from _files order by 1;

commit;
