-- =============================================================================
-- Concession students, Phase 3: monthly payments and manual flags.
-- Safe to run more than once.
--
--   concession_payments  Half and Paid card students: paid / unpaid per
--                        calendar month, with the amount and the day it came.
--   concession_flags     A flag an admin raises on a student (needs review,
--                        warning, top performer) with a reason; resolved later.
--
-- Both are admin-only (the "students" page), like the rest of the private
-- data: members with Student results never see them. Changes are logged.
-- The automatic flags (absences, low marks, unpaid months...) are worked out
-- by the app from this data, so they are never out of date.
-- =============================================================================

create table if not exists public.concession_payments (
  student_id  uuid not null references public.concession_students (id) on delete cascade,
  month       date not null check (extract(day from month) = 1),
  status      text not null check (status in ('paid', 'unpaid')),
  amount      numeric(10, 2) check (amount is null or amount between 0 and 1000000),
  paid_on     date,
  note        text not null default '' check (char_length(note) <= 300),
  recorded_by uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (student_id, month),
  check (status = 'unpaid' or amount is not null)
);
create index if not exists concession_payments_month_idx on public.concession_payments (month);

create table if not exists public.concession_flags (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.concession_students (id) on delete cascade,
  kind         text not null check (kind in ('needs_review', 'warning', 'top')),
  reason       text not null check (char_length(trim(reason)) between 3 and 500),
  raised_by    uuid references public.profiles (id) on delete set null,
  raised_at    timestamptz not null default now(),
  resolved_by  uuid references public.profiles (id) on delete set null,
  resolved_at  timestamptz,
  resolve_note text not null default '' check (char_length(resolve_note) <= 300)
);
create index if not exists concession_flags_student_idx on public.concession_flags (student_id, raised_at desc);
create index if not exists concession_flags_open_idx on public.concession_flags (student_id) where resolved_at is null;

-- -----------------------------------------------------------------------------
-- Record one month's payment. p_status null removes the record.
-- -----------------------------------------------------------------------------
create or replace function public.concession_payment_set(
  p_student uuid, p_month date, p_status text, p_amount numeric default null,
  p_paid_on date default null, p_note text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.concession_students;
  m date := date_trunc('month', p_month)::date;
  summary text;
begin
  if not public.has_page('students', true) then
    raise exception 'You are not allowed to change concession students.' using errcode = '42501';
  end if;
  select * into s from public.concession_students where id = p_student;
  if s.id is null then
    raise exception 'Student not found.' using errcode = 'P0001';
  end if;
  if s.card_type = 'free' then
    raise exception 'A Free card student pays nothing.' using errcode = 'P0001';
  end if;
  if m > date_trunc('month', (now() at time zone 'Asia/Colombo'))::date then
    raise exception 'Payments can''t be recorded for a future month.' using errcode = 'P0001';
  end if;

  if p_status is null then
    delete from public.concession_payments where student_id = p_student and month = m;
    if not found then
      return;
    end if;
    summary := 'Cleared the ' || public.month_name(m) || ' payment of ' || s.full_name || ' (' || s.student_no || ')';
  elsif p_status in ('paid', 'unpaid') then
    if p_status = 'paid' and (p_amount is null or p_amount < 0) then
      raise exception 'Enter the amount paid.' using errcode = 'P0001';
    end if;
    insert into public.concession_payments (student_id, month, status, amount, paid_on, note, recorded_by)
    values (p_student, m, p_status, case when p_status = 'paid' then p_amount end,
            case when p_status = 'paid' then p_paid_on end, left(trim(coalesce(p_note, '')), 300), (select auth.uid()))
    on conflict (student_id, month) do update set
      status      = excluded.status,
      amount      = excluded.amount,
      paid_on     = excluded.paid_on,
      note        = excluded.note,
      recorded_by = excluded.recorded_by,
      updated_at  = now();
    summary := case when p_status = 'paid'
      then 'Recorded ' || public.lkr(p_amount) || ' paid by ' || s.full_name || ' (' || s.student_no || ') for ' || public.month_name(m)
      else 'Marked ' || public.month_name(m) || ' unpaid for ' || s.full_name || ' (' || s.student_no || ')' end;
  else
    raise exception 'Unknown payment status.' using errcode = 'P0001';
  end if;

  perform public.write_activity('student.payment_recorded', 'student', p_student::text, null, summary,
    jsonb_build_object('month', m, 'status', p_status, 'amount', p_amount));
end;
$$;

-- -----------------------------------------------------------------------------
-- Raise and resolve flags.
-- -----------------------------------------------------------------------------
create or replace function public.concession_flag_raise(p_student uuid, p_kind text, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.concession_students;
  fid uuid;
begin
  if not public.has_page('students', true) then
    raise exception 'You are not allowed to change concession students.' using errcode = '42501';
  end if;
  select * into s from public.concession_students where id = p_student;
  if s.id is null then
    raise exception 'Student not found.' using errcode = 'P0001';
  end if;
  if p_kind is null or p_kind not in ('needs_review', 'warning', 'top') then
    raise exception 'Choose the kind of flag.' using errcode = 'P0001';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Write the reason for the flag.' using errcode = 'P0001';
  end if;
  insert into public.concession_flags (student_id, kind, reason, raised_by)
  values (p_student, p_kind, left(trim(p_reason), 500), (select auth.uid()))
  returning id into fid;
  perform public.write_activity('student.flag_raised', 'student', p_student::text, null,
    'Flagged ' || s.full_name || ' (' || s.student_no || '): '
      || case p_kind when 'needs_review' then 'needs review' when 'warning' then 'warning' else 'top performer' end,
    jsonb_build_object('flag_id', fid, 'kind', p_kind));
  return fid;
end;
$$;

create or replace function public.concession_flag_resolve(p_flag uuid, p_note text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f record;
begin
  if not public.has_page('students', true) then
    raise exception 'You are not allowed to change concession students.' using errcode = '42501';
  end if;
  update public.concession_flags
     set resolved_by = (select auth.uid()), resolved_at = now(), resolve_note = left(trim(coalesce(p_note, '')), 300)
   where id = p_flag and resolved_at is null
  returning student_id, kind into f;
  if not found then
    raise exception 'This flag is already resolved.' using errcode = 'P0001';
  end if;
  perform public.write_activity('student.flag_resolved', 'student', f.student_id::text, null,
    'Resolved a flag on ' || coalesce((select full_name || ' (' || student_no || ')' from public.concession_students where id = f.student_id), 'a student'),
    jsonb_build_object('flag_id', p_flag, 'kind', f.kind));
end;
$$;

-- -----------------------------------------------------------------------------
-- Exam totals for the analysis: one row per result of exams dated between
-- p_from and p_to (optionally one student). Admins with the students page.
-- -----------------------------------------------------------------------------
create or replace function public.concession_result_totals(p_from date, p_to date, p_student uuid default null)
returns table (student_id uuid, exam_id uuid, exam_date date, attendance text, total numeric, max_total numeric,
               parts_marked integer, parts integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_page('students') then
    raise exception 'You are not allowed to see concession students.' using errcode = '42501';
  end if;
  return query
    select r.student_id, r.exam_id, e.exam_date, r.attendance,
           (select sum(m.marks) from public.concession_part_marks m where m.result_id = r.id),
           (select sum(p.max_marks) from public.exam_parts p where p.exam_id = r.exam_id),
           (select count(*)::integer from public.concession_part_marks m where m.result_id = r.id),
           (select count(*)::integer from public.exam_parts p where p.exam_id = r.exam_id)
      from public.concession_results r
      join public.exams e on e.id = r.exam_id
     where e.exam_date between p_from and p_to
       and (p_student is null or r.student_id = p_student)
     order by e.exam_date, r.exam_id, r.student_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Row level security: read with the students page; written only by the
-- functions above.
-- -----------------------------------------------------------------------------
alter table public.concession_payments enable row level security;
alter table public.concession_flags    enable row level security;

drop policy if exists "concession_payments: page read" on public.concession_payments;
create policy "concession_payments: page read" on public.concession_payments for select to authenticated
  using ((select public.has_page('students')));
drop policy if exists "concession_flags: page read" on public.concession_flags;
create policy "concession_flags: page read" on public.concession_flags for select to authenticated
  using ((select public.has_page('students')));

revoke all on table public.concession_payments, public.concession_flags from anon, authenticated;
grant select on table public.concession_payments, public.concession_flags to authenticated;

revoke all on function public.concession_payment_set(uuid, date, text, numeric, date, text) from public, anon, authenticated;
revoke all on function public.concession_flag_raise(uuid, text, text) from public, anon, authenticated;
revoke all on function public.concession_flag_resolve(uuid, text) from public, anon, authenticated;
grant execute on function public.concession_payment_set(uuid, date, text, numeric, date, text) to authenticated;
grant execute on function public.concession_flag_raise(uuid, text, text) to authenticated;
grant execute on function public.concession_flag_resolve(uuid, text) to authenticated;
revoke all on function public.concession_result_totals(date, date, uuid) from public, anon, authenticated;
grant execute on function public.concession_result_totals(date, date, uuid) to authenticated;
