-- =============================================================================
-- Concession students, Phase 1: the register and the Grama Niladhari check.
-- Safe to run more than once.
--
-- Students on a fee concession (Free card, Half card, Paid card = a monthly
-- amount they can afford). Staff add them; students never log in.
--
-- A student is "Applied" until an admin verifies them, and verifying needs:
--   a Grama Niladhari (GN) certificate from the last 12 months (file + date +
--   GN division), at least one parent / guardian with their occupation, the
--   parents' consent date and, for Half and Paid cards, the monthly amount.
--
-- Who sees what: everything here needs the "students" admin page
-- (has_page('students'); edit to change anything). Members can't be given
-- this page. Phase 2 lets members see names and enter marks only.
--
-- Every change of card type or status, every verification and every opening
-- of a certificate goes to the activity log (main admins read it).
--
-- Names start with concession_ on purpose: migration 045 (safe to run again)
-- drops public.students and the old student_* functions of Tute dispatch.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tables
-- -----------------------------------------------------------------------------
create table if not exists public.concession_students (
  id                uuid primary key default gen_random_uuid(),
  student_no        text not null check (student_no ~ '^[0-9A-Z][0-9A-Z/-]{0,29}$'),
  full_name         text not null check (char_length(trim(full_name)) between 2 and 120),
  batch_id          uuid not null references public.batches (id) on delete restrict,
  centre_id         uuid references public.centres (id) on delete set null,
  card_type         text not null check (card_type in ('free', 'half', 'paid')),
  status            text not null default 'applied'
                    check (status in ('applied', 'verified', 'under_review', 'ended')),
  status_changed_at timestamptz not null default now(),
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles (id) on delete set null,
  updated_at        timestamptz not null default now()
);
create unique index if not exists concession_students_no_unique on public.concession_students (student_no);
create index if not exists concession_students_batch_idx on public.concession_students (batch_id, lower(full_name));
create index if not exists concession_students_status_idx on public.concession_students (status, status_changed_at);

-- The private part: one row per student.
create table if not exists public.concession_student_private (
  student_id            uuid primary key references public.concession_students (id) on delete cascade,
  gn_division           text not null default '' check (char_length(gn_division) <= 100),
  certificate_issued_on date,
  reason                text not null default '' check (char_length(reason) <= 1000),
  monthly_amount        numeric(10, 2) check (monthly_amount is null or monthly_amount between 0 and 1000000),
  consent_on            date,
  verified_by           uuid references public.profiles (id) on delete set null,
  verified_at           timestamptz,
  updated_by            uuid references public.profiles (id) on delete set null,
  updated_at            timestamptz not null default now()
);

create table if not exists public.concession_guardians (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.concession_students (id) on delete cascade,
  relationship text not null check (relationship in ('mother', 'father', 'guardian')),
  full_name    text not null check (char_length(trim(full_name)) between 2 and 120),
  occupation   text not null check (char_length(trim(occupation)) between 2 and 100),
  phone        text check (phone is null or phone ~ '^0[0-9]{9}$'),
  created_by   uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists concession_guardians_student_idx on public.concession_guardians (student_id, created_at);

-- GN certificate scans. Files live in the private "concession" bucket under <student id>/.
create table if not exists public.concession_documents (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.concession_students (id) on delete cascade,
  storage_path text not null unique check (char_length(storage_path) between 3 and 400),
  file_name    text not null check (char_length(file_name) between 1 and 200),
  mime_type    text check (char_length(mime_type) <= 150),
  size_bytes   bigint not null check (size_bytes between 1 and 10485760),
  uploaded_by  uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists concession_documents_student_idx on public.concession_documents (student_id, created_at);

-- Every card type / status the student has had, with who and why. Written only
-- by the functions below, never edited.
create table if not exists public.concession_card_history (
  id         bigint generated always as identity primary key,
  student_id uuid not null references public.concession_students (id) on delete cascade,
  card_type  text not null check (card_type in ('free', 'half', 'paid')),
  status     text not null check (status in ('applied', 'verified', 'under_review', 'ended')),
  note       text not null default '' check (char_length(note) <= 500),
  changed_by uuid references public.profiles (id) on delete set null,
  changed_at timestamptz not null default now()
);
create index if not exists concession_card_history_student_idx on public.concession_card_history (student_id, changed_at);

-- -----------------------------------------------------------------------------
-- 2. Helpers
-- -----------------------------------------------------------------------------
create or replace function public.concession_card_label(p_card text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_card when 'free' then 'Free card' when 'half' then 'Half card' when 'paid' then 'Paid card' else p_card end;
$$;

create or replace function public.concession_status_label(p_status text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'applied' then 'Applied' when 'verified' then 'Verified'
    when 'under_review' then 'Under review' when 'ended' then 'Ended' else p_status end;
$$;

-- What is still needed before this student can be verified (empty = ready).
-- p_card: check for another card type than the current one (a card change).
-- The app shows the same list (lib/students/rules.ts).
create or replace function public.concession_missing(p_id uuid, p_card text default null)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.concession_students;
  p public.concession_student_private;
  need text[] := '{}';
begin
  if not public.has_page('students') then
    raise exception 'You are not allowed to see concession students.' using errcode = '42501';
  end if;
  select * into s from public.concession_students where id = p_id;
  if s.id is null then
    raise exception 'Student not found.' using errcode = 'P0001';
  end if;
  select * into p from public.concession_student_private where student_id = p_id;

  if not exists (select 1 from public.concession_documents d where d.student_id = p_id) then
    need := need || 'GN certificate file'::text;
  end if;
  if coalesce(p.gn_division, '') = '' then
    need := need || 'GN division'::text;
  end if;
  if p.certificate_issued_on is null then
    need := need || 'Certificate date'::text;
  elsif p.certificate_issued_on < (now() at time zone 'Asia/Colombo')::date - interval '12 months' then
    need := need || 'A certificate from the last 12 months'::text;
  end if;
  if not exists (select 1 from public.concession_guardians g where g.student_id = p_id) then
    need := need || 'Parent occupation'::text;
  end if;
  if p.consent_on is null then
    need := need || 'Parents'' consent'::text;
  end if;
  if coalesce(p_card, s.card_type) in ('half', 'paid') and p.monthly_amount is null then
    need := need || 'Monthly amount'::text;
  end if;
  return need;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Add or edit a student (details and the private part together)
--    p: student_no, full_name, batch_id, centre_id, card_type (new only),
--       gn_division, certificate_issued_on, reason, monthly_amount, consent_on
--    p_expected_updated_at stops two people overwriting each other.
-- -----------------------------------------------------------------------------
create or replace function public.concession_student_save(p jsonb, p_expected_updated_at timestamptz default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  sid uuid := nullif(p ->> 'id', '')::uuid;
  actor uuid := (select auth.uid());
  card text;
  sno text := upper(trim(coalesce(p ->> 'student_no', '')));
  amount numeric;
begin
  if not public.has_page('students', true) then
    raise exception 'You are not allowed to change concession students.' using errcode = '42501';
  end if;
  if sid is null then
    card := p ->> 'card_type';
  else
    select card_type into card from public.concession_students where id = sid;
  end if;
  -- A Free card has no monthly amount.
  amount := case when card = 'free' then null else nullif(p ->> 'monthly_amount', '')::numeric end;

  if sid is null then
    if card is null or card not in ('free', 'half', 'paid') then
      raise exception 'Choose the card type.' using errcode = 'P0001';
    end if;
    insert into public.concession_students (student_no, full_name, batch_id, centre_id, card_type, created_by, updated_by)
    values (sno, trim(p ->> 'full_name'), (p ->> 'batch_id')::uuid, nullif(p ->> 'centre_id', '')::uuid, card, actor, actor)
    on conflict (student_no) do nothing
    returning id into sid;
    if sid is null then
      raise exception 'Student ID % is already registered.', sno using errcode = 'P0001';
    end if;
    insert into public.concession_student_private
      (student_id, gn_division, certificate_issued_on, reason, monthly_amount, consent_on, updated_by)
    values (sid, coalesce(trim(p ->> 'gn_division'), ''), nullif(p ->> 'certificate_issued_on', '')::date,
            coalesce(trim(p ->> 'reason'), ''), amount, nullif(p ->> 'consent_on', '')::date, actor);
    insert into public.concession_card_history (student_id, card_type, status, note, changed_by)
    values (sid, card, 'applied', 'Registered', actor);
    perform public.write_activity('student.added', 'student', sid::text, null,
      'Registered ' || trim(p ->> 'full_name') || ' (' || sno || ') on a ' || public.concession_card_label(card),
      jsonb_build_object('student_no', sno, 'card_type', card));
    return sid;
  end if;

  if card is null then
    raise exception 'Student not found.' using errcode = 'P0001';
  end if;
  if sno <> (select student_no from public.concession_students where id = sid)
     and exists (select 1 from public.concession_students where student_no = sno and id <> sid) then
    raise exception 'Student ID % is already registered.', sno using errcode = 'P0001';
  end if;

  update public.concession_students set
    student_no = sno,
    full_name  = trim(p ->> 'full_name'),
    batch_id   = (p ->> 'batch_id')::uuid,
    centre_id  = nullif(p ->> 'centre_id', '')::uuid,
    updated_by = actor,
    updated_at = now()
  where id = sid
    and (p_expected_updated_at is null or updated_at = p_expected_updated_at);
  if not found then
    raise exception 'This student was changed by someone else. Reload and try again.' using errcode = 'P0001';
  end if;

  insert into public.concession_student_private
    (student_id, gn_division, certificate_issued_on, reason, monthly_amount, consent_on, updated_by)
  values (sid, coalesce(trim(p ->> 'gn_division'), ''), nullif(p ->> 'certificate_issued_on', '')::date,
          coalesce(trim(p ->> 'reason'), ''), amount, nullif(p ->> 'consent_on', '')::date, actor)
  on conflict (student_id) do update set
    gn_division           = excluded.gn_division,
    certificate_issued_on = excluded.certificate_issued_on,
    reason                = excluded.reason,
    monthly_amount        = excluded.monthly_amount,
    consent_on            = excluded.consent_on,
    updated_by            = excluded.updated_by,
    updated_at            = now();

  perform public.write_activity('student.changed', 'student', sid::text, null,
    'Changed the details of ' || trim(p ->> 'full_name') || ' (' || sno || ')',
    jsonb_build_object('student_no', sno));
  return sid;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Change the card type and / or status, with a reason.
--    Verifying checks concession_missing() first; verifying needs no reason.
-- -----------------------------------------------------------------------------
create or replace function public.concession_student_set_card(
  p_id uuid, p_card text, p_status text, p_note text default '', p_expected_updated_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.concession_students;
  actor uuid := (select auth.uid());
  note text := left(trim(coalesce(p_note, '')), 500);
  missing text[];
  action text;
  summary text;
begin
  if not public.has_page('students', true) then
    raise exception 'You are not allowed to change concession students.' using errcode = '42501';
  end if;
  if p_card is null or p_card not in ('free', 'half', 'paid')
     or p_status is null or p_status not in ('applied', 'verified', 'under_review', 'ended') then
    raise exception 'Choose a card type and a status.' using errcode = 'P0001';
  end if;

  select * into s from public.concession_students where id = p_id for update;
  if s.id is null then
    raise exception 'Student not found.' using errcode = 'P0001';
  end if;
  if p_expected_updated_at is not null and s.updated_at <> p_expected_updated_at then
    raise exception 'This student was changed by someone else. Reload and try again.' using errcode = 'P0001';
  end if;
  if s.card_type = p_card and s.status = p_status then
    raise exception 'Nothing changed.' using errcode = 'P0001';
  end if;
  -- Only plain verifying (same card) goes without a reason.
  if not (p_status = 'verified' and s.status <> 'verified' and s.card_type = p_card) and char_length(note) < 3 then
    raise exception 'Write the reason for this change.' using errcode = 'P0001';
  end if;
  if p_status = 'verified' then
    missing := public.concession_missing(p_id, p_card);
    if cardinality(missing) > 0 then
      raise exception 'Before verifying, add: %.', array_to_string(missing, ', ') using errcode = 'P0001';
    end if;
  end if;

  update public.concession_students set
    card_type         = p_card,
    status            = p_status,
    status_changed_at = case when status <> p_status then now() else status_changed_at end,
    updated_by        = actor,
    updated_at        = now()
  where id = p_id;

  if p_card = 'free' then
    update public.concession_student_private set monthly_amount = null where student_id = p_id and monthly_amount is not null;
  end if;
  if p_status = 'verified' and s.status <> 'verified' then
    update public.concession_student_private
       set verified_by = actor, verified_at = now()
     where student_id = p_id;
  end if;

  insert into public.concession_card_history (student_id, card_type, status, note, changed_by)
  values (p_id, p_card, p_status, coalesce(nullif(note, ''), public.concession_status_label(p_status)), actor);

  if s.status <> p_status and p_status = 'verified' then
    action := 'student.verified';
    summary := 'Verified ' || s.full_name || ' (' || s.student_no || ') for a ' || public.concession_card_label(p_card);
  elsif s.status <> p_status and p_status = 'ended' then
    action := 'student.ended';
    summary := 'Ended the ' || public.concession_card_label(p_card) || ' of ' || s.full_name || ' (' || s.student_no || ')';
  elsif s.card_type <> p_card then
    action := 'student.card_changed';
    summary := 'Moved ' || s.full_name || ' (' || s.student_no || ') from a ' || public.concession_card_label(s.card_type)
      || ' to a ' || public.concession_card_label(p_card);
  else
    action := 'student.status_changed';
    summary := 'Set ' || s.full_name || ' (' || s.student_no || ') to ' || public.concession_status_label(p_status);
  end if;
  perform public.write_activity(action, 'student', p_id::text, null, summary,
    jsonb_build_object('from_card', s.card_type, 'card_type', p_card, 'from_status', s.status,
                       'status', p_status, 'note', note));
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Delete a student added by mistake: only while Applied and never verified.
--    Returns the file paths for the app to remove from storage.
-- -----------------------------------------------------------------------------
create or replace function public.concession_student_delete(p_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.concession_students;
  paths text[];
begin
  if not public.has_page('students', true) then
    raise exception 'You are not allowed to change concession students.' using errcode = '42501';
  end if;
  select * into s from public.concession_students where id = p_id for update;
  if s.id is null then
    raise exception 'Student not found.' using errcode = 'P0001';
  end if;
  if s.status <> 'applied'
     or exists (select 1 from public.concession_card_history h where h.student_id = p_id and h.status <> 'applied') then
    raise exception 'Only a student added by mistake (never verified) can be deleted. Set the status to Ended instead.'
      using errcode = 'P0001';
  end if;
  select coalesce(array_agg(storage_path), '{}') into paths from public.concession_documents where student_id = p_id;
  delete from public.concession_students where id = p_id;
  perform public.write_activity('student.deleted', 'student', p_id::text, null,
    'Deleted ' || s.full_name || ' (' || s.student_no || '), added by mistake',
    jsonb_build_object('student_no', s.student_no));
  return paths;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Certificates: opening one is logged (the app calls this before it hands
--    out the 60-second link); adding and removing are logged by a trigger.
-- -----------------------------------------------------------------------------
create or replace function public.concession_document_opened(p_doc uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d record;
begin
  if not public.has_page('students') then
    raise exception 'You are not allowed to see concession students.' using errcode = '42501';
  end if;
  select doc.id, doc.file_name, s.id as sid, s.full_name, s.student_no into d
    from public.concession_documents doc join public.concession_students s on s.id = doc.student_id
   where doc.id = p_doc;
  if d.id is null then
    raise exception 'File not found.' using errcode = 'P0001';
  end if;
  perform public.write_activity('student.document_opened', 'student', d.sid::text, null,
    'Opened the GN certificate of ' || d.full_name || ' (' || d.student_no || ')',
    jsonb_build_object('document_id', d.id, 'file_name', d.file_name));
end;
$$;

create or replace function public.audit_concession_documents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  doc public.concession_documents := case when tg_op = 'DELETE' then old else new end;
  who text;
begin
  select full_name || ' (' || student_no || ')' into who from public.concession_students where id = doc.student_id;
  if who is null then
    return null; -- the student is being deleted (logged there)
  end if;
  perform public.write_activity(
    case when tg_op = 'DELETE' then 'student.document_removed' else 'student.document_added' end,
    'student', doc.student_id::text, null,
    case when tg_op = 'DELETE' then 'Removed a GN certificate file of ' else 'Added a GN certificate file for ' end || who,
    jsonb_build_object('file_name', doc.file_name));
  return null;
end;
$$;

drop trigger if exists concession_documents_audit on public.concession_documents;
create trigger concession_documents_audit
  after insert or delete on public.concession_documents
  for each row execute function public.audit_concession_documents();

-- -----------------------------------------------------------------------------
-- 7. Row level security
--    Students, the private part and the history: read with the page; written
--    only by the functions above. Guardians and files: read with the page,
--    changed with edit access.
-- -----------------------------------------------------------------------------
alter table public.concession_students        enable row level security;
alter table public.concession_student_private enable row level security;
alter table public.concession_guardians       enable row level security;
alter table public.concession_documents       enable row level security;
alter table public.concession_card_history    enable row level security;

drop policy if exists "concession_students: page read" on public.concession_students;
create policy "concession_students: page read" on public.concession_students for select to authenticated
  using ((select public.has_page('students')));

drop policy if exists "concession_student_private: page read" on public.concession_student_private;
create policy "concession_student_private: page read" on public.concession_student_private for select to authenticated
  using ((select public.has_page('students')));

drop policy if exists "concession_card_history: page read" on public.concession_card_history;
create policy "concession_card_history: page read" on public.concession_card_history for select to authenticated
  using ((select public.has_page('students')));

drop policy if exists "concession_guardians: page read" on public.concession_guardians;
create policy "concession_guardians: page read" on public.concession_guardians for select to authenticated
  using ((select public.has_page('students')));
drop policy if exists "concession_guardians: editors add" on public.concession_guardians;
create policy "concession_guardians: editors add" on public.concession_guardians for insert to authenticated
  with check ((select public.has_page('students', true)));
drop policy if exists "concession_guardians: editors change" on public.concession_guardians;
create policy "concession_guardians: editors change" on public.concession_guardians for update to authenticated
  using ((select public.has_page('students', true))) with check ((select public.has_page('students', true)));
drop policy if exists "concession_guardians: editors remove" on public.concession_guardians;
create policy "concession_guardians: editors remove" on public.concession_guardians for delete to authenticated
  using ((select public.has_page('students', true)));

drop policy if exists "concession_documents: page read" on public.concession_documents;
create policy "concession_documents: page read" on public.concession_documents for select to authenticated
  using ((select public.has_page('students')));
drop policy if exists "concession_documents: editors add" on public.concession_documents;
create policy "concession_documents: editors add" on public.concession_documents for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and storage_path like student_id::text || '/%'
    and (select public.has_page('students', true))
  );
drop policy if exists "concession_documents: editors remove" on public.concession_documents;
create policy "concession_documents: editors remove" on public.concession_documents for delete to authenticated
  using ((select public.has_page('students', true)));

-- Nothing for anon. Signed-in users: SELECT everywhere (RLS decides), plus the
-- direct writes allowed above. Without this, the project's default privileges
-- would give anon and authenticated everything on new tables.
revoke all on table public.concession_students, public.concession_student_private, public.concession_guardians,
  public.concession_documents, public.concession_card_history from anon, authenticated;
grant select on table public.concession_students, public.concession_student_private, public.concession_guardians,
  public.concession_documents, public.concession_card_history to authenticated;
grant insert, delete on table public.concession_guardians, public.concession_documents to authenticated;
grant update (relationship, full_name, occupation, phone) on table public.concession_guardians to authenticated;

revoke all on function public.concession_card_label(text) from public, anon;
revoke all on function public.concession_status_label(text) from public, anon;
revoke all on function public.concession_missing(uuid, text) from public, anon, authenticated;
revoke all on function public.concession_student_save(jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.concession_student_set_card(uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.concession_student_delete(uuid) from public, anon, authenticated;
revoke all on function public.concession_document_opened(uuid) from public, anon, authenticated;
revoke all on function public.audit_concession_documents() from public, anon, authenticated;

grant execute on function public.concession_card_label(text) to authenticated;
grant execute on function public.concession_status_label(text) to authenticated;
grant execute on function public.concession_missing(uuid, text) to authenticated;
grant execute on function public.concession_student_save(jsonb, timestamptz) to authenticated;
grant execute on function public.concession_student_set_card(uuid, text, text, text, timestamptz) to authenticated;
grant execute on function public.concession_student_delete(uuid) to authenticated;
grant execute on function public.concession_document_opened(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 8. Storage: private bucket "concession", folders <student id>/<file>.
--    Images or PDF, up to 10 MB. Certificates of students who ended more than
--    12 months ago are deleted by the daily clean-up (/api/hooks/cleanup).
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('concession', 'concession', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "concession bucket: page read" on storage.objects;
create policy "concession bucket: page read"
  on storage.objects for select to authenticated
  using (bucket_id = 'concession' and (select public.has_page('students')));

drop policy if exists "concession bucket: editors add" on storage.objects;
create policy "concession bucket: editors add"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'concession'
    and (select public.has_page('students', true))
    and exists (select 1 from public.concession_students s where s.id::text = (storage.foldername(name))[1])
  );

drop policy if exists "concession bucket: editors remove" on storage.objects;
create policy "concession bucket: editors remove"
  on storage.objects for delete to authenticated
  using (bucket_id = 'concession' and (select public.has_page('students', true)));
