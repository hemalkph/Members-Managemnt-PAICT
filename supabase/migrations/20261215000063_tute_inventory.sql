-- =============================================================================
-- Tute inventory, Phase 1 (docs/TUTE_INVENTORY_PLAN.md). Safe to run more than once.
--
--   tute_printers         Presses / in-house printers and their usual days to print.
--   tute_print_jobs       Print orders: planned → printing → received / cancelled.
--   tute_stock_moves      Every stock change (+ printed, − given out, count fixes...).
--                         Stock on hand = sum of moves. Insert-only, through functions.
--   tute_alert_state      Last low / out level per tute, so alerts fire once per change.
--   fee_month_upload_log  One row per paid-list upload (history for a later forecast).
--
-- Who sees what: the new "tutes" admin page (has_page('tutes'); edit access to
-- change stock). Can be given to members, e.g. the Physical Coordinator.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. has_page() learns 'tutes' (assignable to members)
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
      when p_page = any (array['papers', 'tasks', 'classes', 'notices', 'student_results', 'students', 'fee_reminders', 'tutes']) then
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

revoke execute on function public.has_page(text, boolean) from public, anon;
grant execute on function public.has_page(text, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Tables
-- -----------------------------------------------------------------------------
alter table public.class_tutes
  add column if not exists pages integer check (pages is null or pages between 1 and 2000),
  add column if not exists reorder_level integer check (reorder_level is null or reorder_level between 0 and 100000),
  add column if not exists print_batch integer not null default 1 check (print_batch between 1 and 10000);

create table if not exists public.tute_printers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(trim(name)) between 2 and 100),
  phone      text not null default '' check (char_length(phone) <= 30),
  notes      text not null default '' check (char_length(notes) <= 300),
  usual_days integer not null default 7 check (usual_days between 1 and 90),
  is_active  boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists tute_printers_name_unique on public.tute_printers (lower(name));

create table if not exists public.tute_print_jobs (
  id           uuid primary key default gen_random_uuid(),
  tute_id      uuid not null references public.class_tutes (id) on delete restrict,
  printer_id   uuid references public.tute_printers (id) on delete set null,
  qty          integer not null check (qty between 1 and 100000),
  received_qty integer not null default 0 check (received_qty between 0 and 200000),
  status       text not null default 'planned' check (status in ('planned', 'printing', 'received', 'cancelled')),
  cost         numeric(12, 2) check (cost is null or cost between 0 and 100000000),
  due_date     date,
  note         text not null default '' check (char_length(note) <= 300),
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  received_at  timestamptz
);
create index if not exists tute_print_jobs_tute_idx on public.tute_print_jobs (tute_id, status, created_at desc);
create index if not exists tute_print_jobs_open_idx on public.tute_print_jobs (status, due_date);

create table if not exists public.tute_stock_moves (
  id         uuid primary key default gen_random_uuid(),
  tute_id    uuid not null references public.class_tutes (id) on delete restrict,
  qty        integer not null check (qty <> 0 and qty between -100000 and 100000),
  kind       text not null check (kind in ('opening_stock', 'print_in', 'class_issue', 'post_out', 'return_in', 'damaged', 'count_fix')),
  class_id   uuid references public.fee_classes (id) on delete set null,
  month      date check (month is null or extract(day from month) = 1),
  ref_id     uuid,
  note       text not null default '' check (char_length(note) <= 300),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists tute_stock_moves_tute_idx on public.tute_stock_moves (tute_id, created_at desc);
create index if not exists tute_stock_moves_month_idx on public.tute_stock_moves (tute_id, month, kind);

create table if not exists public.tute_alert_state (
  tute_id    uuid primary key references public.class_tutes (id) on delete cascade,
  level      text not null check (level in ('ok', 'low', 'out')),
  updated_at timestamptz not null default now()
);

create table if not exists public.fee_month_upload_log (
  id            bigint generated always as identity primary key,
  class_id      uuid not null references public.fee_classes (id) on delete cascade,
  month         date not null,
  student_count integer not null,
  uploaded_at   timestamptz not null default now()
);
create index if not exists fee_month_upload_log_idx on public.fee_month_upload_log (class_id, month, uploaded_at);

-- Each upload replaces the month's list, so keep how many students each upload had.
create or replace function public.fee_month_upload_logged()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.fee_month_upload_log (class_id, month, student_count, uploaded_at)
  values (new.class_id, new.month, new.unique_student_count, new.uploaded_at);
  return null;
end;
$$;

drop trigger if exists fee_month_imports_upload_log on public.fee_month_imports;
create trigger fee_month_imports_upload_log
  after insert or update on public.fee_month_imports
  for each row execute function public.fee_month_upload_logged();

-- -----------------------------------------------------------------------------
-- 3. The numbers (internal helpers, one place for the page and the alerts)
-- -----------------------------------------------------------------------------

-- Students expected in a class for a month: that month's uploaded paid count,
-- else the latest earlier month's (shortcut: Phase 2 replaces this with a forecast).
create or replace function public.tute_expected_students(p_class uuid, p_month date)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select i.unique_student_count
    from public.fee_month_imports i
    where i.class_id = p_class and i.month <= p_month
    order by i.month desc
    limit 1
  ), 0);
$$;

create or replace function public.tute_status(
  p_on_hand integer, p_in_print integer, p_left_this integer, p_need_next integer,
  p_reorder integer, p_this boolean, p_next boolean
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when not p_this and not p_next then 'not_scheduled'
    when p_this and p_left_this > 0 and p_on_hand <= 0 then 'out'
    when p_on_hand + p_in_print < p_left_this + p_need_next
      or (p_reorder is not null and p_on_hand < p_reorder) then 'low'
    else 'ok'
  end;
$$;

-- Stock and need for every tute (or one batch) in a month.
create or replace function public.tute_levels(p_month date, p_batch uuid default null)
returns table (
  tute_id uuid, batch_id uuid, name text, is_active boolean, reorder_level integer,
  on_hand integer, in_print integer, open_jobs integer,
  need_this integer, given_this integer, need_next integer,
  scheduled_this boolean, scheduled_next boolean, status text
)
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select
      ct.id, ct.batch_id, ct.name, ct.is_active, ct.reorder_level,
      coalesce((select sum(mv.qty) from public.tute_stock_moves mv where mv.tute_id = ct.id), 0)::integer as on_hand,
      coalesce((select sum(greatest(j.qty - j.received_qty, 0)) from public.tute_print_jobs j
                where j.tute_id = ct.id and j.status in ('planned', 'printing')), 0)::integer as in_print,
      (select count(*) from public.tute_print_jobs j
        where j.tute_id = ct.id and j.status in ('planned', 'printing'))::integer as open_jobs,
      coalesce((select sum(public.tute_expected_students(s.class_id, s.month)) from public.class_month_tutes s
                where s.tute_id = ct.id and s.month = p_month), 0)::integer as need_this,
      coalesce((select sum(-mv.qty) from public.tute_stock_moves mv
                where mv.tute_id = ct.id and mv.month = p_month and mv.kind in ('class_issue', 'post_out')), 0)::integer as given_this,
      coalesce((select sum(public.tute_expected_students(s.class_id, s.month)) from public.class_month_tutes s
                where s.tute_id = ct.id and s.month = (p_month + interval '1 month')::date), 0)::integer as need_next,
      exists (select 1 from public.class_month_tutes s where s.tute_id = ct.id and s.month = p_month) as scheduled_this,
      exists (select 1 from public.class_month_tutes s
              where s.tute_id = ct.id and s.month = (p_month + interval '1 month')::date) as scheduled_next
    from public.class_tutes ct
    where p_batch is null or ct.batch_id = p_batch
  )
  select
    b.id, b.batch_id, b.name, b.is_active, b.reorder_level, b.on_hand, b.in_print, b.open_jobs,
    b.need_this, b.given_this, b.need_next, b.scheduled_this, b.scheduled_next,
    public.tute_status(b.on_hand, b.in_print, greatest(b.need_this - b.given_this, 0), b.need_next,
                       b.reorder_level, b.scheduled_this, b.scheduled_next)
  from base b;
$$;

-- Who gets tute alerts: everyone who can open the Tutes page.
create or replace function public.tute_alert_people()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles p
  where p.is_active
    and (p.is_main_admin
         or (p.is_admin and coalesce(p.page_access ->> 'tutes', 'edit') in ('edit', 'view'))
         or (not p.is_admin and p.page_access ->> 'tutes' in ('edit', 'view')));
$$;

-- -----------------------------------------------------------------------------
-- 4. Reads
-- -----------------------------------------------------------------------------
create or replace function public.tute_stock_summary(p_batch uuid, p_month date)
returns table (
  tute_id uuid, code text, name text, is_active boolean, pages integer, print_batch integer,
  reorder_level integer, paper_id uuid, paper_ready boolean,
  on_hand integer, in_print integer, open_jobs integer,
  need_this integer, given_this integer, need_next integer, status text, classes jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  m date := date_trunc('month', coalesce(p_month, current_date))::date;
begin
  if not public.has_page('tutes') then
    raise exception 'You are not allowed to see tute stock.' using errcode = '42501';
  end if;
  return query
  select
    ct.id, ct.code, ct.name, ct.is_active, ct.pages, ct.print_batch, ct.reorder_level, ct.paper_id,
    (ct.paper_id is not null and (public.library_file_ok(ct.paper_id, 'typeset_si')
                                  or public.library_file_ok(ct.paper_id, 'typeset_en')
                                  or public.library_file_ok(ct.paper_id, 'handover'))),
    l.on_hand, l.in_print, l.open_jobs, l.need_this, l.given_this, l.need_next, l.status,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', fc.id,
               'name', fc.name,
               'expected', public.tute_expected_students(fc.id, m),
               'given', coalesce((select sum(-mv.qty) from public.tute_stock_moves mv
                                  where mv.tute_id = ct.id and mv.class_id = fc.id
                                    and mv.month = m and mv.kind = 'class_issue'), 0))
             order by fc.name)
      from public.class_month_tutes s
      join public.fee_classes fc on fc.id = s.class_id
      where s.tute_id = ct.id and s.month = m
    ), '[]'::jsonb)
  from public.class_tutes ct
  join public.tute_levels(m, p_batch) l on l.tute_id = ct.id
  order by ct.is_active desc, lower(ct.name);
end;
$$;

-- Small stock chips for the Fee reminders Tutes tab and Paper Library cards.
create or replace function public.tute_stock_levels(p_tute_ids uuid[] default null, p_paper_ids uuid[] default null)
returns table (tute_id uuid, batch_id uuid, paper_id uuid, name text, on_hand integer, in_print integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not (public.has_page('tutes') or public.has_page('fee_reminders')) then
    raise exception 'You are not allowed to see tute stock.' using errcode = '42501';
  end if;
  return query
  select
    ct.id, ct.batch_id, ct.paper_id, ct.name,
    coalesce((select sum(mv.qty) from public.tute_stock_moves mv where mv.tute_id = ct.id), 0)::integer,
    coalesce((select sum(greatest(j.qty - j.received_qty, 0)) from public.tute_print_jobs j
              where j.tute_id = ct.id and j.status in ('planned', 'printing')), 0)::integer
  from public.class_tutes ct
  where (p_tute_ids is not null and ct.id = any (p_tute_ids))
     or (p_paper_ids is not null and ct.paper_id = any (p_paper_ids));
end;
$$;

-- Counts for the sidebar badge and the dashboard "Today" card (low / out come
-- from the alert state, which every stock change and the daily job keep fresh).
create or replace function public.tute_today()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Colombo')::date;
begin
  if not public.has_page('tutes') then
    raise exception 'You are not allowed to see tute stock.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'low', (select count(*) from public.tute_alert_state s join public.class_tutes ct on ct.id = s.tute_id
            where ct.is_active and s.level = 'low'),
    'out', (select count(*) from public.tute_alert_state s join public.class_tutes ct on ct.id = s.tute_id
            where ct.is_active and s.level = 'out'),
    'late', (select count(*) from public.tute_print_jobs
             where status in ('planned', 'printing') and due_date < today),
    'due_soon', (select count(*) from public.tute_print_jobs
                 where status in ('planned', 'printing') and due_date between today and today + 7));
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Alerts: daily at 9:00, after stock changes, and when someone opens the page
-- -----------------------------------------------------------------------------
create or replace function public.send_tute_stock_alerts(p_tute uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Colombo')::date;
  m date := date_trunc('month', today)::date;
  nxt date := (date_trunc('month', today) + interval '1 month')::date;
  r record;
  j record;
  who uuid;
  prev text;
  lvl text;
  lead integer;
  sent integer := 0;
begin
  -- The daily job runs with no user; people may only trigger it with the page.
  if (select auth.uid()) is not null and not public.has_page('tutes') then
    return 0;
  end if;

  for r in
    select * from public.tute_levels(m) l
    where l.is_active and (p_tute is null or l.tute_id = p_tute)
  loop
    lvl := case when r.status in ('low', 'out') then r.status else 'ok' end;
    select s.level into prev from public.tute_alert_state s where s.tute_id = r.tute_id;
    prev := coalesce(prev, 'ok');

    -- Low / out: once each time it gets worse; recovering resets it.
    if (lvl = 'low' and prev = 'ok') or (lvl = 'out' and prev <> 'out') then
      for who in select public.tute_alert_people() loop
        perform public.notify(
          who,
          'tute.' || lvl,
          case lvl when 'out' then 'Out of stock: ' else 'Low stock: ' end || r.name,
          'On hand ' || r.on_hand || ', printing ' || r.in_print || '. Still needed: '
            || greatest(r.need_this - r.given_this, 0) || ' this month, ' || r.need_next || ' next month.',
          '/admin/tutes',
          'tute-' || lvl || ':' || r.tute_id || ':' || today);
        sent := sent + 1;
      end loop;
    end if;
    if lvl is distinct from prev then
      insert into public.tute_alert_state (tute_id, level, updated_at)
      values (r.tute_id, lvl, now())
      on conflict (tute_id) do update set level = excluded.level, updated_at = excluded.updated_at;
    end if;

    -- Next month is close and nothing is being printed for it.
    if r.scheduled_next and r.open_jobs = 0 and r.on_hand < r.need_next then
      select coalesce((
        select p.usual_days from public.tute_print_jobs pj
        join public.tute_printers p on p.id = pj.printer_id
        where pj.tute_id = r.tute_id
        order by pj.created_at desc
        limit 1
      ), 7) into lead;
      if today >= nxt - (lead + 3) then
        for who in select public.tute_alert_people() loop
          perform public.notify(
            who,
            'tute.not_ready',
            'Not ready for ' || public.month_name(nxt) || ': ' || r.name,
            'About ' || r.need_next || ' copies needed, ' || r.on_hand || ' on hand. Printing takes about '
              || lead || ' days, so start a print job now.',
            '/admin/tutes',
            'tute-not-ready:' || r.tute_id || ':' || nxt);
          sent := sent + 1;
        end loop;
      end if;
    end if;
  end loop;

  -- Print jobs past their due date.
  for j in
    select pj.id, pj.due_date, ct.name, coalesce(p.name, '') as printer
    from public.tute_print_jobs pj
    join public.class_tutes ct on ct.id = pj.tute_id
    left join public.tute_printers p on p.id = pj.printer_id
    where pj.status in ('planned', 'printing') and pj.due_date < today
      and (p_tute is null or pj.tute_id = p_tute)
  loop
    for who in select public.tute_alert_people() loop
      perform public.notify(
        who,
        'tute.job_late',
        'Print job late: ' || j.name,
        'It was due ' || to_char(j.due_date, 'FMDD Mon YYYY')
          || case when j.printer <> '' then ' at ' || j.printer else '' end
          || '. Mark it received when the copies arrive.',
        '/admin/tutes?tab=jobs',
        'tute-job-late:' || j.id);
      sent := sent + 1;
    end loop;
  end loop;

  return sent;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Changes (each one checks edit access, locks the tute, logs the activity)
-- -----------------------------------------------------------------------------
create or replace function public.tute_settings_save(
  p_tute uuid, p_pages integer, p_reorder_level integer, p_print_batch integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
begin
  if not public.has_page('tutes', true) then
    raise exception 'You are not allowed to change tute stock.' using errcode = '42501';
  end if;
  select id, name into t from public.class_tutes where id = p_tute for update;
  if t.id is null then
    raise exception 'Tute not found.' using errcode = 'P0001';
  end if;
  update public.class_tutes
     set pages = p_pages,
         reorder_level = p_reorder_level,
         print_batch = coalesce(p_print_batch, 1)
   where id = p_tute;
  perform public.write_activity('tute.settings', 'class_tute', p_tute::text, null,
    'Changed stock settings for "' || t.name || '"',
    jsonb_build_object('pages', p_pages, 'reorder_level', p_reorder_level, 'print_batch', p_print_batch));
end;
$$;

create or replace function public.tute_printer_save(
  p_id uuid, p_name text, p_phone text default '', p_notes text default '',
  p_usual_days integer default 7, p_is_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  pname text := trim(coalesce(p_name, ''));
  pid uuid;
begin
  if not public.has_page('tutes', true) then
    raise exception 'You are not allowed to change printers.' using errcode = '42501';
  end if;
  if char_length(pname) < 2 or char_length(pname) > 100 then
    raise exception 'Printer name must be between 2 and 100 characters.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.tute_printers where lower(name) = lower(pname) and id is distinct from p_id) then
    raise exception 'A printer named "%" already exists.', pname using errcode = 'P0001';
  end if;
  if p_id is null then
    insert into public.tute_printers (name, phone, notes, usual_days, is_active, created_by)
    values (pname, left(trim(coalesce(p_phone, '')), 30), left(trim(coalesce(p_notes, '')), 300),
            coalesce(p_usual_days, 7), coalesce(p_is_active, true), (select auth.uid()))
    returning id into pid;
  else
    update public.tute_printers
       set name = pname,
           phone = left(trim(coalesce(p_phone, '')), 30),
           notes = left(trim(coalesce(p_notes, '')), 300),
           usual_days = coalesce(p_usual_days, 7),
           is_active = coalesce(p_is_active, true)
     where id = p_id
    returning id into pid;
    if pid is null then
      raise exception 'Printer not found.' using errcode = 'P0001';
    end if;
  end if;
  perform public.write_activity('tute.printer_saved', 'tute_printer', pid::text, null,
    case when p_id is null then 'Added printer "' else 'Updated printer "' end || pname || '"', '{}'::jsonb);
  return pid;
end;
$$;

create or replace function public.tute_print_job_create(
  p_tute uuid, p_qty integer, p_printer uuid default null, p_due_date date default null,
  p_cost numeric default null, p_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
  jid uuid;
begin
  if not public.has_page('tutes', true) then
    raise exception 'You are not allowed to create print jobs.' using errcode = '42501';
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 100000 then
    raise exception 'Copies must be between 1 and 100,000.' using errcode = 'P0001';
  end if;
  select id, name into t from public.class_tutes where id = p_tute;
  if t.id is null then
    raise exception 'Tute not found.' using errcode = 'P0001';
  end if;
  if p_printer is not null and not exists (select 1 from public.tute_printers where id = p_printer and is_active) then
    raise exception 'Printer not found.' using errcode = 'P0001';
  end if;
  insert into public.tute_print_jobs (tute_id, printer_id, qty, due_date, cost, note, created_by)
  values (p_tute, p_printer, p_qty, p_due_date, p_cost, left(trim(coalesce(p_note, '')), 300), (select auth.uid()))
  returning id into jid;
  perform public.write_activity('tute.print_job_created', 'tute_print_job', jid::text, null,
    'Print job: ' || p_qty || ' copies of "' || t.name || '"',
    jsonb_build_object('tute_id', p_tute, 'qty', p_qty, 'printer_id', p_printer, 'due_date', p_due_date));
  return jid;
end;
$$;

-- planned → printing, or planned / printing → cancelled (copies already received stay in stock).
create or replace function public.tute_print_job_set_status(p_id uuid, p_status text)
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
  if p_status not in ('printing', 'cancelled') then
    raise exception 'Unknown print job status.' using errcode = 'P0001';
  end if;
  select pj.id, pj.status, pj.tute_id, ct.name into j
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
  update public.tute_print_jobs
     set status = p_status,
         started_at = case when p_status = 'printing' then coalesce(started_at, now()) else started_at end
   where id = p_id;
  perform public.write_activity('tute.print_job_' || p_status, 'tute_print_job', p_id::text, null,
    case p_status when 'printing' then 'Printing started: "' else 'Print job cancelled: "' end || j.name || '"',
    jsonb_build_object('tute_id', j.tute_id));
  perform public.send_tute_stock_alerts(j.tute_id);
end;
$$;

-- Copies arrived (all or part). Writes a print_in move; the job closes when all are in.
create or replace function public.tute_print_job_receive(p_id uuid, p_qty integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  j record;
  total integer;
begin
  if not public.has_page('tutes', true) then
    raise exception 'You are not allowed to receive print jobs.' using errcode = '42501';
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 100000 then
    raise exception 'Copies must be between 1 and 100,000.' using errcode = 'P0001';
  end if;
  select pj.id, pj.status, pj.qty, pj.received_qty, pj.tute_id into j
    from public.tute_print_jobs pj
   where pj.id = p_id
     for update;
  if j.id is null then
    raise exception 'Print job not found.' using errcode = 'P0001';
  end if;
  if j.status not in ('planned', 'printing') then
    raise exception 'This print job is already closed.' using errcode = 'P0001';
  end if;
  perform 1 from public.class_tutes where id = j.tute_id for update;

  total := j.received_qty + p_qty;
  insert into public.tute_stock_moves (tute_id, qty, kind, ref_id, note, created_by)
  values (j.tute_id, p_qty, 'print_in', p_id, 'Print job', (select auth.uid()));
  update public.tute_print_jobs
     set received_qty = total,
         started_at = coalesce(started_at, now()),
         status = case when total >= qty then 'received' else 'printing' end,
         received_at = case when total >= qty then now() else received_at end
   where id = p_id;
  perform public.write_activity('tute.print_job_received', 'tute_print_job', p_id::text, null,
    'Received ' || p_qty || ' printed copies (' || total || ' of ' || j.qty || ')',
    jsonb_build_object('tute_id', j.tute_id, 'qty', p_qty, 'received_total', total));
  perform public.send_tute_stock_alerts(j.tute_id);
  return total;
end;
$$;

-- Copies leave the shelf: given to a class, or damaged. Never below zero.
create or replace function public.tute_stock_issue(
  p_tute uuid, p_qty integer, p_kind text, p_class uuid default null,
  p_month date default null, p_note text default ''
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
  cls record;
  class_name text := '';
  have integer;
  m date := date_trunc('month', coalesce(p_month, (now() at time zone 'Asia/Colombo')::date))::date;
begin
  if not public.has_page('tutes', true) then
    raise exception 'You are not allowed to change tute stock.' using errcode = '42501';
  end if;
  if p_kind not in ('class_issue', 'damaged') then
    raise exception 'Unknown stock change.' using errcode = 'P0001';
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 100000 then
    raise exception 'Copies must be between 1 and 100,000.' using errcode = 'P0001';
  end if;
  select id, name, batch_id into t from public.class_tutes where id = p_tute for update;
  if t.id is null then
    raise exception 'Tute not found.' using errcode = 'P0001';
  end if;
  if p_kind = 'class_issue' then
    select id, name, batch_id into cls from public.fee_classes where id = p_class;
    if cls.id is null or cls.batch_id <> t.batch_id then
      raise exception 'Pick the class the copies were given to.' using errcode = 'P0001';
    end if;
    class_name := cls.name;
  end if;
  select coalesce(sum(qty), 0) into have from public.tute_stock_moves where tute_id = p_tute;
  if have < p_qty then
    raise exception 'Only % copies on hand.', have using errcode = 'P0001';
  end if;

  insert into public.tute_stock_moves (tute_id, qty, kind, class_id, month, note, created_by)
  values (p_tute, -p_qty, p_kind, case when p_kind = 'class_issue' then p_class end, m,
          left(trim(coalesce(p_note, '')), 300), (select auth.uid()));
  perform public.write_activity('tute.' || p_kind, 'class_tute', p_tute::text, null,
    case p_kind
      when 'class_issue' then 'Gave ' || p_qty || ' copies of "' || t.name || '" to ' || class_name
      else 'Marked ' || p_qty || ' copies of "' || t.name || '" damaged'
    end,
    jsonb_build_object('qty', p_qty, 'class_id', p_class, 'month', m));
  perform public.send_tute_stock_alerts(p_tute);
  return have - p_qty;
end;
$$;

-- Shelf count. The first count of a tute is its opening stock; later counts
-- write the difference as a count fix. Returns the change.
create or replace function public.tute_stock_count(p_tute uuid, p_counted integer, p_note text default '')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
  have integer;
  first_count boolean;
  diff integer;
begin
  if not public.has_page('tutes', true) then
    raise exception 'You are not allowed to change tute stock.' using errcode = '42501';
  end if;
  if p_counted is null or p_counted < 0 or p_counted > 100000 then
    raise exception 'Count must be between 0 and 100,000.' using errcode = 'P0001';
  end if;
  select id, name into t from public.class_tutes where id = p_tute for update;
  if t.id is null then
    raise exception 'Tute not found.' using errcode = 'P0001';
  end if;
  first_count := not exists (select 1 from public.tute_stock_moves where tute_id = p_tute);
  select coalesce(sum(qty), 0) into have from public.tute_stock_moves where tute_id = p_tute;
  diff := p_counted - have;
  if diff = 0 then
    return 0;
  end if;

  insert into public.tute_stock_moves (tute_id, qty, kind, note, created_by)
  values (p_tute, diff, case when first_count then 'opening_stock' else 'count_fix' end,
          left(trim(coalesce(p_note, '')), 300), (select auth.uid()));
  perform public.write_activity(case when first_count then 'tute.opening_stock' else 'tute.count_fix' end,
    'class_tute', p_tute::text, null,
    case when first_count
      then 'Opening stock for "' || t.name || '": ' || p_counted
      else 'Counted "' || t.name || '": ' || p_counted || ' (' || case when diff > 0 then '+' else '' end || diff || ')'
    end,
    jsonb_build_object('counted', p_counted, 'change', diff));
  perform public.send_tute_stock_alerts(p_tute);
  return diff;
end;
$$;

-- A tute with stock history can't be deleted (the history would be lost).
create or replace function public.class_tute_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
begin
  if not public.has_page('fee_reminders', true) then
    raise exception 'You are not allowed to manage class tutes.' using errcode = '42501';
  end if;
  select id, name into t from public.class_tutes where id = p_id;
  if t.id is null then
    raise exception 'Tute not found.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.tute_stock_moves where tute_id = p_id)
     or exists (select 1 from public.tute_print_jobs where tute_id = p_id) then
    raise exception '"%" has stock or print history, so it can''t be deleted. Remove it from its months instead.', t.name
      using errcode = 'P0001';
  end if;
  delete from public.class_tutes where id = p_id;
  perform public.write_activity('fee.tute_deleted', 'class_tute', p_id::text, null,
    'Deleted tute "' || t.name || '" from catalog',
    jsonb_build_object('name', t.name));
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Row Level Security & Grants
-- -----------------------------------------------------------------------------
drop policy if exists "class_tutes: page read" on public.class_tutes;
create policy "class_tutes: page read" on public.class_tutes for select to authenticated
  using ((select public.has_page('fee_reminders')) or (select public.has_page('tutes')));

-- Class names only (no students), for "given to which class".
drop policy if exists "fee_classes: page read" on public.fee_classes;
create policy "fee_classes: page read" on public.fee_classes for select to authenticated
  using ((select public.has_page('fee_reminders')) or (select public.has_page('tutes')));

alter table public.tute_printers        enable row level security;
alter table public.tute_print_jobs      enable row level security;
alter table public.tute_stock_moves     enable row level security;
alter table public.tute_alert_state     enable row level security;
alter table public.fee_month_upload_log enable row level security;

drop policy if exists "tute_printers: page read" on public.tute_printers;
create policy "tute_printers: page read" on public.tute_printers for select to authenticated
  using ((select public.has_page('tutes')));
drop policy if exists "tute_print_jobs: page read" on public.tute_print_jobs;
create policy "tute_print_jobs: page read" on public.tute_print_jobs for select to authenticated
  using ((select public.has_page('tutes')));
drop policy if exists "tute_stock_moves: page read" on public.tute_stock_moves;
create policy "tute_stock_moves: page read" on public.tute_stock_moves for select to authenticated
  using ((select public.has_page('tutes')));

-- Only the functions above write; nobody can edit or delete a stock move.
revoke all on table public.tute_printers, public.tute_print_jobs, public.tute_stock_moves,
  public.tute_alert_state, public.fee_month_upload_log from anon, authenticated;
grant select on table public.tute_printers, public.tute_print_jobs, public.tute_stock_moves to authenticated;

revoke all on function public.fee_month_upload_logged() from public, anon, authenticated;
revoke all on function public.tute_expected_students(uuid, date) from public, anon, authenticated;
revoke all on function public.tute_levels(date, uuid) from public, anon, authenticated;
revoke all on function public.tute_alert_people() from public, anon, authenticated;
revoke all on function public.tute_status(integer, integer, integer, integer, integer, boolean, boolean) from public, anon;

revoke all on function public.tute_stock_summary(uuid, date) from public, anon;
revoke all on function public.tute_stock_levels(uuid[], uuid[]) from public, anon;
revoke all on function public.tute_today() from public, anon;
revoke all on function public.send_tute_stock_alerts(uuid) from public, anon;
revoke all on function public.tute_settings_save(uuid, integer, integer, integer) from public, anon;
revoke all on function public.tute_printer_save(uuid, text, text, text, integer, boolean) from public, anon;
revoke all on function public.tute_print_job_create(uuid, integer, uuid, date, numeric, text) from public, anon;
revoke all on function public.tute_print_job_set_status(uuid, text) from public, anon;
revoke all on function public.tute_print_job_receive(uuid, integer) from public, anon;
revoke all on function public.tute_stock_issue(uuid, integer, text, uuid, date, text) from public, anon;
revoke all on function public.tute_stock_count(uuid, integer, text) from public, anon;

grant execute on function public.tute_status(integer, integer, integer, integer, integer, boolean, boolean) to authenticated;
grant execute on function public.tute_stock_summary(uuid, date) to authenticated;
grant execute on function public.tute_stock_levels(uuid[], uuid[]) to authenticated;
grant execute on function public.tute_today() to authenticated;
grant execute on function public.send_tute_stock_alerts(uuid) to authenticated;
grant execute on function public.tute_settings_save(uuid, integer, integer, integer) to authenticated;
grant execute on function public.tute_printer_save(uuid, text, text, text, integer, boolean) to authenticated;
grant execute on function public.tute_print_job_create(uuid, integer, uuid, date, numeric, text) to authenticated;
grant execute on function public.tute_print_job_set_status(uuid, text) to authenticated;
grant execute on function public.tute_print_job_receive(uuid, integer) to authenticated;
grant execute on function public.tute_stock_issue(uuid, integer, text, uuid, date, text) to authenticated;
grant execute on function public.tute_stock_count(uuid, integer, text) to authenticated;

-- 9:00 Sri Lanka time = 03:30 UTC (scheduling the same name again replaces it)
select cron.schedule('tute-stock-alerts', '30 3 * * *', $$ select public.send_tute_stock_alerts(); $$);
