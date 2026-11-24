-- =============================================================================
-- Edit an open print job (qty, printer, due date, cost, note) without having to
-- cancel and recreate it. Safe to run more than once.
-- =============================================================================

create or replace function public.tute_print_job_update(
  p_id uuid,
  p_qty integer,
  p_printer uuid default null,
  p_due_date date default null,
  p_cost numeric default null,
  p_note text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  j record;
begin
  if not public.has_page('tutes', true) then
    raise exception 'You are not allowed to change print jobs.' using errcode = '42501';
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 100000 then
    raise exception 'Copies must be between 1 and 100,000.' using errcode = 'P0001';
  end if;
  if p_cost is not null and (p_cost < 0 or p_cost > 100000000) then
    raise exception 'Cost must be between 0 and 100,000,000.' using errcode = 'P0001';
  end if;

  select pj.id, pj.status, pj.qty, pj.received_qty, pj.printer_id, pj.tute_id, ct.name
    into j
    from public.tute_print_jobs pj
    join public.class_tutes ct on ct.id = pj.tute_id
   where pj.id = p_id
     for update of pj;

  if j.id is null then
    raise exception 'Print job not found.' using errcode = 'P0001';
  end if;
  if j.status not in ('planned', 'printing') then
    raise exception 'This print job is already closed.' using errcode = 'P0001';
  end if;
  if p_qty < j.received_qty then
    raise exception 'Copies can''t be less than the % already received.', j.received_qty using errcode = 'P0001';
  end if;
  if p_printer is not null and not exists (
       select 1 from public.tute_printers
       where id = p_printer and (is_active or id = j.printer_id)
     ) then
    raise exception 'Printer not found.' using errcode = 'P0001';
  end if;

  update public.tute_print_jobs
     set qty = p_qty,
         printer_id = p_printer,
         due_date = p_due_date,
         cost = p_cost,
         note = left(trim(coalesce(p_note, '')), 300),
         status = case when received_qty > 0 and p_qty <= received_qty then 'received' else status end,
         received_at = case when received_qty > 0 and p_qty <= received_qty then coalesce(received_at, now()) else received_at end
   where id = p_id;

  perform public.write_activity('tute.print_job_changed', 'tute_print_job', p_id::text, null,
    'Updated print job for "' || j.name || '" (' || p_qty || ' copies)',
    jsonb_build_object('tute_id', j.tute_id, 'qty', p_qty, 'printer_id', p_printer, 'due_date', p_due_date, 'cost', p_cost));

  perform public.send_tute_stock_alerts(j.tute_id);
end;
$$;

revoke all on function public.tute_print_job_update(uuid, integer, uuid, date, numeric, text) from public, anon;
grant execute on function public.tute_print_job_update(uuid, integer, uuid, date, numeric, text) to authenticated;
