-- =============================================================================
-- Exam series: "Ranking Full Papers" (RFP) → RFP 01, RFP 02, … → MCQ and
-- SE & Essay. Safe to run more than once.
--
--   * exam_series: one batch's series, with a short code and the parts every
--     exam in it has (name + full marks).
--   * exams.series_id / exams.number: the numbered exam ("RFP 05"). The exam
--     row is what papers, tasks, work and results already point at, so all of
--     them now show "RFP 05".
--   * exam_series_next(): adds the next exam of a series with its parts.
--   * Parts can also be changed from Batches & exams (not only Student results).
--   * The existing "Ranking Full Papers" and "RFP" exams of 2027 A/L become
--     RFP 05 and RFP 04 of one series; their papers and tasks move to the right
--     exam. Paid work (closed months) is not changed.
-- =============================================================================

create table if not exists public.exam_series (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid not null references public.batches (id) on delete cascade,
  name          text not null check (char_length(trim(name)) between 2 and 80),
  code          text not null check (code ~ '^[A-Z0-9][A-Z0-9-]{0,11}$'),
  -- [{ "name": "MCQ", "max_marks": 50 }, …] added to every new exam of the series.
  default_parts jsonb not null default '[]'::jsonb check (jsonb_typeof(default_parts) = 'array' and jsonb_array_length(default_parts) <= 6),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);
create unique index if not exists exam_series_name_unique on public.exam_series (batch_id, lower(name));
create unique index if not exists exam_series_code_unique on public.exam_series (batch_id, code);

alter table public.exam_series enable row level security;
drop policy if exists "exam_series: signed-in users read" on public.exam_series;
create policy "exam_series: signed-in users read" on public.exam_series for select to authenticated using (true);
drop policy if exists "exam_series: page editors manage" on public.exam_series;
create policy "exam_series: page editors manage" on public.exam_series for all to authenticated
  using ((select public.has_page('classes', true))) with check ((select public.has_page('classes', true)));
revoke all on table public.exam_series from anon;
grant select, insert, update, delete on table public.exam_series to authenticated;

alter table public.exams add column if not exists series_id uuid references public.exam_series (id); -- no action: a series with exams can't be deleted, but a whole batch can
alter table public.exams add column if not exists number integer check (number between 1 and 999);
create unique index if not exists exams_series_number_unique on public.exams (series_id, number) where series_id is not null;
create index if not exists exams_series_idx on public.exams (series_id);

-- Parts: Batches & exams editors can change them too.
drop policy if exists "exam_parts: results editors add" on public.exam_parts;
create policy "exam_parts: results editors add" on public.exam_parts for insert to authenticated
  with check ((select public.has_page('student_results', true) or public.has_page('classes', true)));
drop policy if exists "exam_parts: results editors change" on public.exam_parts;
create policy "exam_parts: results editors change" on public.exam_parts for update to authenticated
  using ((select public.has_page('student_results', true) or public.has_page('classes', true)))
  with check ((select public.has_page('student_results', true) or public.has_page('classes', true)));
drop policy if exists "exam_parts: results editors remove" on public.exam_parts;
create policy "exam_parts: results editors remove" on public.exam_parts for delete to authenticated
  using ((select public.has_page('student_results', true) or public.has_page('classes', true)));

-- Internal: give an exam its series' parts (skips names it already has).
create or replace function public.exam_add_series_parts(p_exam uuid, p_parts jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.exam_parts (exam_id, name, max_marks, sort_order)
  select p_exam, trim(x.value ->> 'name'), (x.value ->> 'max_marks')::numeric, x.ordinality::integer
  from jsonb_array_elements(p_parts) with ordinality x
  where nullif(trim(x.value ->> 'name'), '') is not null
  on conflict (exam_id, lower(name)) do nothing;
$$;
revoke all on function public.exam_add_series_parts(uuid, jsonb) from public, anon, authenticated;

-- The next exam of a series: number = last + 1, named "<code> 06", with the
-- series' parts. Returns the new exam's id.
create or replace function public.exam_series_next(p_series uuid, p_exam_date date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.exam_series;
  n integer;
  eid uuid;
begin
  if not public.has_page('classes', true) then
    raise exception 'You are not allowed to change batches and exams.' using errcode = '42501';
  end if;
  select * into s from public.exam_series where id = p_series for update;
  if s.id is null then
    raise exception 'Series not found.' using errcode = 'P0002';
  end if;
  select coalesce(max(number), 0) + 1 into n from public.exams where series_id = s.id;
  insert into public.exams (batch_id, name, exam_date, series_id, number)
  values (s.batch_id, s.code || ' ' || lpad(n::text, 2, '0'), p_exam_date, s.id, n)
  returning id into eid;
  perform public.exam_add_series_parts(eid, s.default_parts);
  return eid;
end;
$$;
revoke all on function public.exam_series_next(uuid, date) from public, anon, authenticated;
grant execute on function public.exam_series_next(uuid, date) to authenticated;

-- -----------------------------------------------------------------------------
-- Move today's data: 2027 A/L "Ranking Full Papers" + "RFP" → one RFP series.
-- Only runs while those two exams exist and have no series. Work already
-- submitted keeps its exam (October is paid and closed): "RFP" becomes RFP 04
-- (its work was RFP 04's), "Ranking Full Papers" becomes RFP 05.
-- -----------------------------------------------------------------------------
do $$
declare
  batch uuid;
  sid uuid;
  old_full uuid; -- "Ranking Full Papers"
  old_rfp uuid;  -- "RFP"
  p record;
  n integer;
  eid uuid;
  parts jsonb := '[{"name": "MCQ", "max_marks": 50}, {"name": "SE & Essay", "max_marks": 100}]';
begin
  select e.batch_id, e.id into batch, old_full
  from public.exams e join public.batches b on b.id = e.batch_id
  where b.name = '2027 A/L' and e.name = 'Ranking Full Papers' and e.series_id is null;
  select e.id into old_rfp from public.exams e where e.batch_id = batch and e.name = 'RFP' and e.series_id is null;
  if old_full is null or old_rfp is null then
    return;
  end if;

  insert into public.exam_series (batch_id, name, code, default_parts)
  values (batch, 'Ranking Full Papers', 'RFP', parts)
  returning id into sid;

  update public.exams set name = 'RFP 04', series_id = sid, number = 4 where id = old_rfp;
  update public.exams set name = 'RFP 05', series_id = sid, number = 5 where id = old_full;
  -- Parts added by hand before (no marks yet) make way for the series' parts.
  delete from public.exam_parts x
  where x.exam_id in (old_rfp, old_full)
    and not exists (select 1 from public.concession_part_marks m where m.part_id = x.id);

  -- Every RFP paper of this batch's exams, or not tagged yet: to its numbered exam.
  for p in
    select id, title, exam_id, exam_day, (regexp_match(title, '^\s*RFP\s*0*([0-9]{1,3})', 'i'))[1]::integer as num
    from public.papers
    where title ~* '^\s*RFP\s*[0-9]'
      and (exam_id in (old_rfp, old_full) or exam_id is null)
  loop
    n := p.num;
    select id into eid from public.exams where series_id = sid and number = n;
    if eid is null then
      insert into public.exams (batch_id, name, series_id, number)
      values (batch, 'RFP ' || lpad(n::text, 2, '0'), sid, n)
      returning id into eid;
    end if;
    update public.papers
    set exam_id = eid,
        part = case when title ~* 'essay' then 'essay' when title ~* 'mcq' then 'mcq' else part end
    where id = p.id;
    update public.tasks t set exam_id = eid
    from public.paper_stages ps
    where ps.paper_id = p.id and t.paper_stage_id = ps.id and t.exam_id is distinct from eid;
  end loop;

  -- Each exam's date is its first paper's day (the MCQ); then its parts.
  update public.exams e
  set exam_date = coalesce(e.exam_date, (select min(pp.exam_day) from public.papers pp where pp.exam_id = e.id))
  where e.series_id = sid;
  for eid in select id from public.exams where series_id = sid loop
    perform public.exam_add_series_parts(eid, parts);
  end loop;
end;
$$;
