-- =============================================================================
-- Concession students, Phase 2: exam results. Safe to run more than once.
--
-- A new page "student_results" that can be given to members (two-step login
-- needed, like Papers and Tasks). With it they see only what marking needs:
-- student ID, name, batch, centre and card type (through concession_roster()),
-- and the results. Never the certificate, parents, reason, amount, status or
-- history - those tables still need the admin-only "students" page.
--
--   exam_parts             the parts of an exam (Paper I MCQ / 40, Paper II / 60)
--   concession_results     one row per student per exam: present / absent / excused
--   concession_part_marks  marks per part (none when absent)
-- An exam's month is the month of its exam date.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Page access: members can now be given "student_results".
--    Same body as migration 045, with the key added to the member list.
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
      when p_page = any (array['papers', 'tasks', 'classes', 'notices', 'student_results']) then
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
create table if not exists public.exam_parts (
  id         uuid primary key default gen_random_uuid(),
  exam_id    uuid not null references public.exams (id) on delete cascade,
  name       text not null check (char_length(trim(name)) between 1 and 60),
  max_marks  numeric(6, 2) not null check (max_marks > 0 and max_marks <= 1000),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists exam_parts_name_unique on public.exam_parts (exam_id, lower(name));
create index if not exists exam_parts_exam_idx on public.exam_parts (exam_id, sort_order);

create table if not exists public.concession_results (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.concession_students (id) on delete cascade,
  exam_id    uuid not null references public.exams (id) on delete cascade,
  attendance text not null check (attendance in ('present', 'absent', 'excused')),
  note       text not null default '' check (char_length(note) <= 300),
  entered_by uuid references public.profiles (id) on delete set null,
  entered_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index if not exists concession_results_unique on public.concession_results (student_id, exam_id);
create index if not exists concession_results_exam_idx on public.concession_results (exam_id);

create table if not exists public.concession_part_marks (
  result_id uuid not null references public.concession_results (id) on delete cascade,
  part_id   uuid not null references public.exam_parts (id) on delete cascade,
  marks     numeric(6, 2) not null check (marks >= 0),
  primary key (result_id, part_id)
);
create index if not exists concession_part_marks_part_idx on public.concession_part_marks (part_id);

-- Lowering a part's full marks below marks already entered is refused.
create or replace function public.guard_exam_part_max()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.max_marks < old.max_marks
     and exists (select 1 from public.concession_part_marks m where m.part_id = new.id and m.marks > new.max_marks) then
    raise exception 'Some students already have more than % marks for %.', new.max_marks, new.name using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_exam_part_max() from public, anon, authenticated;

drop trigger if exists exam_parts_guard_max on public.exam_parts;
create trigger exam_parts_guard_max
  before update of max_marks on public.exam_parts
  for each row execute function public.guard_exam_part_max();

-- -----------------------------------------------------------------------------
-- 3. Who can read or enter results: the results page, or the students page.
-- -----------------------------------------------------------------------------
create or replace function public.can_see_results()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_page('student_results') or public.has_page('students');
$$;
revoke all on function public.can_see_results() from public, anon;
grant execute on function public.can_see_results() to authenticated;

-- The students of an exam's batch, with only what marking needs. Students
-- whose card ended still show when they have a result for this exam.
create or replace function public.concession_roster(p_exam uuid)
returns table (student_id uuid, student_no text, full_name text, card_type text, centre_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_see_results() then
    raise exception 'You are not allowed to see student results.' using errcode = '42501';
  end if;
  return query
    select s.id, s.student_no, s.full_name, s.card_type, s.centre_id
      from public.concession_students s
      join public.exams e on e.id = p_exam and e.batch_id = s.batch_id
     where s.status <> 'ended'
        or exists (select 1 from public.concession_results r where r.student_id = s.id and r.exam_id = p_exam)
     order by lower(s.full_name), s.student_no;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Save the results grid for one exam, all or nothing.
--    p_rows: [{ "student_id", "attendance": "present"|"absent"|"excused"|null,
--               "note", "marks": { "<part id>": number | null } }]
--    attendance null clears the student's result. Absent / excused keep no marks.
-- -----------------------------------------------------------------------------
create or replace function public.concession_results_save(p_exam uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  ex public.exams;
  r jsonb;
  sid uuid;
  att text;
  rid uuid;
  part record;
  val text;
  actor uuid := (select auth.uid());
  n integer := 0;
begin
  if not (public.has_page('student_results', true) or public.has_page('students', true)) then
    raise exception 'You are not allowed to enter student results.' using errcode = '42501';
  end if;
  select * into ex from public.exams where id = p_exam;
  if ex.id is null then
    raise exception 'Exam not found.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception 'Save at most 1,000 students at a time.' using errcode = 'P0001';
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    sid := (r ->> 'student_id')::uuid;
    att := nullif(r ->> 'attendance', '');
    if not exists (
      select 1 from public.concession_students s
       where s.id = sid and s.batch_id = ex.batch_id
         and (s.status <> 'ended'
              or exists (select 1 from public.concession_results x where x.student_id = sid and x.exam_id = p_exam))
    ) then
      raise exception 'A student in the list is not in this exam''s batch.' using errcode = 'P0001';
    end if;

    if att is null then
      delete from public.concession_results where student_id = sid and exam_id = p_exam;
      n := n + 1;
      continue;
    end if;
    if att not in ('present', 'absent', 'excused') then
      raise exception 'Unknown attendance.' using errcode = 'P0001';
    end if;

    insert into public.concession_results (student_id, exam_id, attendance, note, entered_by, updated_by)
    values (sid, p_exam, att, left(trim(coalesce(r ->> 'note', '')), 300), actor, actor)
    on conflict (student_id, exam_id) do update set
      attendance = excluded.attendance,
      note       = excluded.note,
      updated_by = actor,
      updated_at = now()
    returning id into rid;

    delete from public.concession_part_marks where result_id = rid;
    if att = 'present' and jsonb_typeof(r -> 'marks') = 'object' then
      for part in select p.id, p.name, p.max_marks from public.exam_parts p where p.exam_id = p_exam loop
        val := nullif(r -> 'marks' ->> part.id::text, '');
        continue when val is null;
        if val !~ '^\d{1,4}(\.\d{1,2})?$' or val::numeric > part.max_marks then
          raise exception '% marks must be between 0 and %.', part.name, part.max_marks using errcode = 'P0001';
        end if;
        insert into public.concession_part_marks (result_id, part_id, marks) values (rid, part.id, val::numeric);
      end loop;
    end if;
    n := n + 1;
  end loop;

  if n > 0 then
    perform public.write_activity('student.results_saved', 'exam', p_exam::text, null,
      'Saved the results of ' || n || ' student' || case when n = 1 then '' else 's' end || ' for ' || ex.name,
      jsonb_build_object('exam_id', p_exam, 'rows', n));
  end if;
  return n;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Row level security
-- -----------------------------------------------------------------------------
alter table public.exam_parts            enable row level security;
alter table public.concession_results    enable row level security;
alter table public.concession_part_marks enable row level security;

-- Parts are not private: anyone signed in reads them (like exams).
drop policy if exists "exam_parts: signed-in users read" on public.exam_parts;
create policy "exam_parts: signed-in users read" on public.exam_parts for select to authenticated using (true);
drop policy if exists "exam_parts: results editors add" on public.exam_parts;
create policy "exam_parts: results editors add" on public.exam_parts for insert to authenticated
  with check ((select public.has_page('student_results', true)));
drop policy if exists "exam_parts: results editors change" on public.exam_parts;
create policy "exam_parts: results editors change" on public.exam_parts for update to authenticated
  using ((select public.has_page('student_results', true))) with check ((select public.has_page('student_results', true)));
drop policy if exists "exam_parts: results editors remove" on public.exam_parts;
create policy "exam_parts: results editors remove" on public.exam_parts for delete to authenticated
  using ((select public.has_page('student_results', true)));

drop policy if exists "concession_results: results readers" on public.concession_results;
create policy "concession_results: results readers" on public.concession_results for select to authenticated
  using ((select public.can_see_results()));
drop policy if exists "concession_part_marks: results readers" on public.concession_part_marks;
create policy "concession_part_marks: results readers" on public.concession_part_marks for select to authenticated
  using ((select public.can_see_results()));

revoke all on table public.exam_parts, public.concession_results, public.concession_part_marks from anon, authenticated;
grant select on table public.exam_parts, public.concession_results, public.concession_part_marks to authenticated;
grant insert, delete on table public.exam_parts to authenticated;
grant update (name, max_marks, sort_order) on table public.exam_parts to authenticated;

revoke all on function public.concession_roster(uuid) from public, anon, authenticated;
revoke all on function public.concession_results_save(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.concession_roster(uuid) to authenticated;
grant execute on function public.concession_results_save(uuid, jsonb) to authenticated;
