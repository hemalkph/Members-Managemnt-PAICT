-- =============================================================================
-- Concession students: CSV import of students and of past payments.
-- Safe to run more than once.
--
-- The app reads the CSV in the browser, checks every row and shows a preview;
-- these functions save the rows the admin confirmed, all or nothing.
--   * Students already registered (same student ID) are skipped, never changed.
--   * Payments already recorded for that student and month are skipped.
--   * Every imported student starts as Applied: the GN certificate scan is
--     uploaded and checked afterwards, as for a student added by hand.
-- One activity log entry per import. Needs the "students" page with edit.
-- =============================================================================

-- p_rows: [{ student_no, full_name, batch_id, centre_id, card_type, gn_division,
--            certificate_issued_on, reason, monthly_amount, consent_on,
--            guardians: [{ relationship, full_name, occupation, phone }] }]
-- Returns how many students were added.
create or replace function public.concession_students_import(p_rows jsonb, p_file_name text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  g jsonb;
  sid uuid;
  card text;
  actor uuid := (select auth.uid());
  line integer := 0;
  added integer := 0;
begin
  if not public.has_page('students', true) then
    raise exception 'You are not allowed to change concession students.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception 'Import at most 1,000 rows at a time.' using errcode = 'P0001';
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    line := line + 1;
    begin
      card := r ->> 'card_type';
      if card is null or card not in ('free', 'half', 'paid') then
        raise exception 'choose the card type';
      end if;
      if jsonb_typeof(coalesce(r -> 'guardians', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(r -> 'guardians', '[]'::jsonb)) > 2 then
        raise exception 'at most 2 parents';
      end if;

      insert into public.concession_students (student_no, full_name, batch_id, centre_id, card_type, created_by, updated_by)
      values (upper(trim(r ->> 'student_no')), trim(r ->> 'full_name'), (r ->> 'batch_id')::uuid,
              nullif(r ->> 'centre_id', '')::uuid, card, actor, actor)
      on conflict (student_no) do nothing
      returning id into sid;
      continue when sid is null; -- already registered: skipped

      insert into public.concession_student_private
        (student_id, gn_division, certificate_issued_on, reason, monthly_amount, consent_on, updated_by)
      values (sid, coalesce(trim(r ->> 'gn_division'), ''), nullif(r ->> 'certificate_issued_on', '')::date,
              coalesce(trim(r ->> 'reason'), ''),
              case when card = 'free' then null else nullif(r ->> 'monthly_amount', '')::numeric end,
              nullif(r ->> 'consent_on', '')::date, actor);

      for g in select value from jsonb_array_elements(coalesce(r -> 'guardians', '[]'::jsonb)) loop
        insert into public.concession_guardians (student_id, relationship, full_name, occupation, phone, created_by)
        values (sid, g ->> 'relationship', trim(g ->> 'full_name'), trim(g ->> 'occupation'), nullif(trim(g ->> 'phone'), ''), actor);
      end loop;

      insert into public.concession_card_history (student_id, card_type, status, note, changed_by)
      values (sid, card, 'applied', 'Registered (import)', actor);
      added := added + 1;
    exception when others then
      raise exception 'Row % (student ID %): %', line, coalesce(r ->> 'student_no', '?'), sqlerrm using errcode = 'P0001';
    end;
  end loop;

  if added > 0 then
    perform public.write_activity('student.imported', 'student', null, null,
      'Imported ' || added || ' student' || case when added = 1 then '' else 's' end
        || ' from ' || left(coalesce(nullif(trim(p_file_name), ''), 'a CSV file'), 120),
      jsonb_build_object('rows', jsonb_array_length(p_rows), 'added', added));
  end if;
  return added;
end;
$$;

-- p_rows: [{ student_id, month: "YYYY-MM-01", status: "paid"|"unpaid", amount, paid_on, note }]
-- Returns how many payments were added.
create or replace function public.concession_payments_import(p_rows jsonb, p_file_name text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  s public.concession_students;
  m date;
  st text;
  actor uuid := (select auth.uid());
  this_month date := date_trunc('month', (now() at time zone 'Asia/Colombo'))::date;
  line integer := 0;
  added integer := 0;
begin
  if not public.has_page('students', true) then
    raise exception 'You are not allowed to change concession students.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception 'Import at most 1,000 rows at a time.' using errcode = 'P0001';
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    line := line + 1;
    begin
      select * into s from public.concession_students where id = (r ->> 'student_id')::uuid;
      if s.id is null then
        raise exception 'student not found';
      end if;
      if s.card_type = 'free' then
        raise exception 'a Free card student pays nothing';
      end if;
      m := date_trunc('month', (r ->> 'month')::date)::date;
      if m > this_month then
        raise exception 'the month is in the future';
      end if;
      st := r ->> 'status';
      if st is null or st not in ('paid', 'unpaid') then
        raise exception 'status must be paid or unpaid';
      end if;
      if st = 'paid' and nullif(r ->> 'amount', '') is null then
        raise exception 'enter the amount paid';
      end if;

      insert into public.concession_payments (student_id, month, status, amount, paid_on, note, recorded_by)
      values (s.id, m, st, case when st = 'paid' then (r ->> 'amount')::numeric end,
              case when st = 'paid' then nullif(r ->> 'paid_on', '')::date end,
              left(trim(coalesce(r ->> 'note', '')), 300), actor)
      on conflict (student_id, month) do nothing;
      if found then
        added := added + 1;
      end if;
    exception when others then
      raise exception 'Row %: %', line, sqlerrm using errcode = 'P0001';
    end;
  end loop;

  if added > 0 then
    perform public.write_activity('student.payments_imported', 'student', null, null,
      'Imported ' || added || ' payment' || case when added = 1 then '' else 's' end
        || ' from ' || left(coalesce(nullif(trim(p_file_name), ''), 'a CSV file'), 120),
      jsonb_build_object('rows', jsonb_array_length(p_rows), 'added', added));
  end if;
  return added;
end;
$$;

revoke all on function public.concession_students_import(jsonb, text) from public, anon, authenticated;
revoke all on function public.concession_payments_import(jsonb, text) from public, anon, authenticated;
grant execute on function public.concession_students_import(jsonb, text) to authenticated;
grant execute on function public.concession_payments_import(jsonb, text) to authenticated;
