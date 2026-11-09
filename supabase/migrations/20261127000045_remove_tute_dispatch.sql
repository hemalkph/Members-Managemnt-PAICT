-- =============================================================================
-- Remove Tute dispatch (the team is moving from CityPak to Speed Post).
-- Safe to run twice. Runs as one transaction: all of it or nothing.
--
-- 1. Members can no longer be given the dispatch page; saved access is cleared.
-- 2. Old dispatch notifications are removed.
-- 3. The dispatch storage rules, tables, view and functions are dropped.
--
-- The files in the `dispatch` storage bucket can't be removed with SQL
-- (Supabase blocks it): empty and delete the bucket in Dashboard → Storage.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Page access
-- -----------------------------------------------------------------------------
create or replace function public.has_page(p_page text, p_edit boolean default false)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when coalesce((select auth.jwt() ->> 'aal'), '') <> 'aal2' then false
      when p.is_admin and p.is_main_admin then true
      when p.is_admin then
        case coalesce(p.page_access ->> p_page, 'edit')
          when 'edit' then true
          when 'view' then not p_edit
          else false
        end
      when p_page = any (array['papers', 'tasks', 'classes', 'notices']) then
        case p.page_access ->> p_page
          when 'edit' then true
          when 'view' then not p_edit
          else false
        end
      else false
    end
    from public.profiles p
    where p.id = (select auth.uid()) and p.is_active
  ), false);
$$;

-- An empty map means "defaults", which the app saves as null.
update public.profiles
   set page_access = nullif(page_access - 'dispatch', '{}'::jsonb)
 where page_access ? 'dispatch';

-- -----------------------------------------------------------------------------
-- 2. Notifications
-- -----------------------------------------------------------------------------
delete from public.notifications where kind like 'dispatch.%';

-- -----------------------------------------------------------------------------
-- 3. Storage rules, tables, view, functions
-- -----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select policyname from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and policyname like 'dispatch bucket:%'
  loop
    execute format('drop policy if exists %I on storage.objects', r.policyname);
  end loop;
end $$;

drop view if exists public.citypak_order_matches;

-- No table outside this list points at these, so cascade only removes their own
-- triggers, rules and links (and takes `parcels` out of live updates).
drop table if exists
  public.citypak_order_history,
  public.citypak_orders,
  public.citypak_sync_runs,
  public.citypak_bulk_uploads,
  public.cod_settlement_lines,
  public.cod_settlements,
  public.handover_parcels,
  public.handovers,
  public.parcel_scans,
  public.parcel_exceptions,
  public.parcel_events,
  public.parcel_items,
  public.parcel_recipients,
  public.parcels,
  public.carrier_files,
  public.round_students,
  public.round_tutes,
  public.dispatch_rounds,
  public.student_imports,
  public.students,
  public.dispatch_tutes,
  public.dispatch_grants,
  public.dispatch_settings
  cascade;

-- No cascade: if anything outside dispatch still used one of these, this stops
-- with an error instead of quietly removing it.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as fn
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any (array[
         'carrier_file_record', 'citypak_check_scope', 'citypak_log_document',
         'citypak_order_history_append_only', 'citypak_record_failed_sync',
         'citypak_sync_bulk_uploads', 'citypak_sync_orders', 'citypak_template_set',
         'cod_writeoff_set', 'delivery_set', 'dispatch_batch_clear', 'dispatch_block_reason',
         'dispatch_can_pack', 'dispatch_cod_rows', 'dispatch_grant', 'dispatch_handover_block',
         'dispatch_handover_list', 'dispatch_lock_draft', 'dispatch_log_download',
         'dispatch_my_caps', 'dispatch_name', 'dispatch_notify_cap', 'dispatch_pack_list',
         'dispatch_packers', 'dispatch_parcel_card', 'dispatch_people_with',
         'dispatch_report_people', 'dispatch_report_rounds', 'dispatch_require',
         'dispatch_retention_files', 'dispatch_retention_mark_deleted', 'dispatch_retention_run',
         'dispatch_revoke', 'dispatch_round_team', 'dispatch_round_totals',
         'dispatch_settings_save', 'dispatch_settlement_draft', 'dispatch_settlements',
         'dispatch_tute_archive', 'dispatch_tute_counts', 'dispatch_tute_save',
         'exception_open', 'exception_resolve', 'handover_cancel', 'handover_confirm',
         'handover_open', 'handover_release', 'handover_scan', 'has_dispatch',
         'notify_dispatch_parcels', 'notify_dispatch_round', 'parcel_assign', 'parcel_correct',
         'parcel_events_append_only', 'parcel_replace', 'parcel_scan_confirm',
         'parcel_undo_pack', 'parcel_unpack', 'parcel_void', 'round_cancel', 'round_close',
         'round_close_check', 'round_copy', 'round_finalise', 'round_reopen', 'round_save',
         'round_set_students', 'round_set_tutes', 'round_student_gets', 'scan_lookup',
         'settlement_add_lines', 'settlement_attach', 'settlement_cancel', 'settlement_confirm',
         'settlement_remove_line', 'settlement_save', 'settlement_set_line', 'student_delete', 'student_import_start', 'student_save', 'student_set_active',
         'students_import_apply', 'sync_parcel_hold', 'tracking_apply'
       ])
  loop
    execute format('drop function if exists %s', r.fn);
  end loop;
end $$;

commit;
