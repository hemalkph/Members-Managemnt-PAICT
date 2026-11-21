-- =============================================================================
-- Monthly Class Fee Due Tracker & Customizable WhatsApp Reminders.
-- Safe to run more than once.
--
--   fee_classes           Classes inside each A/L batch (e.g. "2027 Grand Revision",
--                         "2027 Theory"). Each class keeps isolated monthly paid lists.
--   fee_month_imports     Metadata for the latest uploaded paid list per (class, month).
--   fee_month_students    Deduplicated paid students for each (class, month) snapshot.
--   fee_due_followups     Per-student WhatsApp follow-up state, labels & notes for a
--                         due month. Persists across mid-month re-uploads.
--   fee_message_templates Team-shared customizable WhatsApp message templates (with emojis).
--
-- Who sees what: needs the "fee_reminders" admin page (has_page('fee_reminders');
-- edit access to upload/change). Can be given to trusted members (with two-step aal2).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Extend has_page() with 'fee_reminders' (assignable to members)
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
      when p_page = any (array['papers', 'tasks', 'classes', 'notices', 'student_results', 'students', 'fee_reminders']) then
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
create table if not exists public.fee_classes (
  id         uuid primary key default gen_random_uuid(),
  batch_id   uuid not null references public.batches (id) on delete restrict,
  name       text not null check (char_length(trim(name)) between 2 and 120),
  is_active  boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists fee_classes_batch_name_unique on public.fee_classes (batch_id, lower(name));
create index if not exists fee_classes_batch_idx on public.fee_classes (batch_id, is_active, lower(name));

create table if not exists public.fee_month_imports (
  id                   uuid primary key default gen_random_uuid(),
  class_id             uuid not null references public.fee_classes (id) on delete cascade,
  month                date not null check (extract(day from month) = 1),
  file_name            text not null default '' check (char_length(file_name) <= 200),
  raw_row_count        integer not null default 0 check (raw_row_count >= 0),
  unique_student_count integer not null default 0 check (unique_student_count >= 0),
  duplicates_merged    integer not null default 0 check (duplicates_merged >= 0),
  uploaded_by          uuid references public.profiles (id) on delete set null,
  uploaded_at          timestamptz not null default now(),
  unique (class_id, month)
);
create index if not exists fee_month_imports_class_idx on public.fee_month_imports (class_id, month desc);

create table if not exists public.fee_month_students (
  id             uuid primary key default gen_random_uuid(),
  class_id       uuid not null references public.fee_classes (id) on delete cascade,
  month          date not null check (extract(day from month) = 1),
  student_key    text not null check (char_length(student_key) between 2 and 200),
  full_name      text not null check (char_length(trim(full_name)) between 1 and 150),
  email_norm     text not null default '' check (char_length(email_norm) <= 200),
  raw_email      text not null default '' check (char_length(raw_email) <= 200),
  whatsapp_norm  text check (whatsapp_norm is null or whatsapp_norm ~ '^[0-9]{9,15}$'),
  raw_whatsapp   text not null default '' check (char_length(raw_whatsapp) <= 60),
  mobile_norm    text check (mobile_norm is null or mobile_norm ~ '^[0-9]{9,15}$'),
  raw_mobile     text not null default '' check (char_length(raw_mobile) <= 60),
  institute      text not null default '' check (char_length(institute) <= 100),
  district       text not null default '' check (char_length(district) <= 100),
  is_new_student boolean not null default false,
  amount         numeric(10, 2) check (amount is null or amount between 0 and 10000000),
  export_label   text not null default '' check (char_length(export_label) <= 120),
  raw_classes    text not null default '' check (char_length(raw_classes) <= 500),
  created_at     timestamptz not null default now(),
  unique (class_id, month, student_key)
);
create index if not exists fee_month_students_lookup_idx on public.fee_month_students (class_id, month, lower(full_name));

create table if not exists public.fee_message_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(trim(name)) between 2 and 80),
  body       text not null check (char_length(trim(body)) between 5 and 3000),
  is_default boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists fee_message_templates_name_unique on public.fee_message_templates (lower(name));
create unique index if not exists fee_message_templates_one_default on public.fee_message_templates (is_default) where is_default;

create table if not exists public.fee_due_followups (
  id               uuid primary key default gen_random_uuid(),
  class_id         uuid not null references public.fee_classes (id) on delete cascade,
  due_month        date not null check (extract(day from due_month) = 1),
  student_key      text not null check (char_length(student_key) between 2 and 200),
  student_name     text not null default '' check (char_length(student_name) <= 150),
  email_norm       text not null default '' check (char_length(email_norm) <= 200),
  whatsapp_norm    text check (whatsapp_norm is null or whatsapp_norm ~ '^[0-9]{9,15}$'),
  status           text not null default 'pending' check (status in ('pending', 'messaged', 'excused', 'dropped')),
  label            text not null default '' check (char_length(label) <= 80),
  message_count    integer not null default 0 check (message_count >= 0),
  last_messaged_at timestamptz,
  last_messaged_by uuid references public.profiles (id) on delete set null,
  last_template_id uuid references public.fee_message_templates (id) on delete set null,
  note             text not null default '' check (char_length(note) <= 500),
  updated_by       uuid references public.profiles (id) on delete set null,
  updated_at       timestamptz not null default now(),
  unique (class_id, due_month, student_key)
);
create index if not exists fee_due_followups_lookup_idx on public.fee_due_followups (class_id, due_month, status);

-- Seed starter templates once (only when the table is completely empty).
insert into public.fee_message_templates (name, body, is_default)
select v.name, v.body, v.is_default
from (
  values
    (
      'Friendly Reminder (English)',
      E'Hi {first_name} 👋✨\n\nHope you''re doing well! 📚 This is a friendly reminder regarding your *{class}* fee for *{month}*.\n\nWe received your *{prev_month}* payment ✅, and your *{month}* payment ({amount}) is still pending ⏳.\n\nPlease settle it soon so you don''t miss upcoming lessons & tutes 📝🎓. If you have already paid, kindly share your receipt or ignore this message 💬🙏.\n\nThank you! 🌟',
      true
    ),
    (
      'Friendly Reminder (Sinhala)',
      E'ආයුබෝවන් {first_name} 👋✨\n\nඔබගේ *{class}* පන්තියේ *{month_si}* මාසයේ පන්ති ගාස්තුව ({amount}) තවමත් ගෙවා නොමැති බව කාරුණිකව මතක් කර සිටිමු 📢⏳.\n\n*{prev_month_si}* මාසය සඳහා ඔබගේ ගෙවීම ලැබී ඇත ✅. නව පාඩම් සහ ටියුට් මගනොහැර ලබාගැනීමට හැකි ඉක්මනින් ගෙවීම සිදු කරන්න 📚🎓.\n\nදැනටමත් ගෙවා ඇත්නම් කරුණාකර රිසිට්පත එවන්න හෝ මෙම පණිවිඩය නොසලකා හරින්න 💬🙏.\n\nස්තූතියි! 🌟',
      false
    )
) as v(name, body, is_default)
where not exists (select 1 from public.fee_message_templates);

-- -----------------------------------------------------------------------------
-- 3. RPC Functions
-- -----------------------------------------------------------------------------

-- Create or update a class inside a batch.
create or replace function public.fee_class_save(
  p_id uuid,
  p_batch_id uuid,
  p_name text,
  p_is_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  cname text := trim(coalesce(p_name, ''));
  cid uuid := p_id;
  bname text;
begin
  if not public.has_page('fee_reminders', true) then
    raise exception 'You are not allowed to change fee reminder classes.' using errcode = '42501';
  end if;
  if char_length(cname) < 2 or char_length(cname) > 120 then
    raise exception 'Class name must be between 2 and 120 characters.' using errcode = 'P0001';
  end if;
  select name into bname from public.batches where id = p_batch_id;
  if bname is null then
    raise exception 'Batch not found.' using errcode = 'P0001';
  end if;

  if cid is null then
    insert into public.fee_classes (batch_id, name, is_active, created_by)
    values (p_batch_id, cname, coalesce(p_is_active, true), actor)
    on conflict (batch_id, lower(name)) do nothing
    returning id into cid;
    if cid is null then
      raise exception 'Class "%" already exists in %.', cname, bname using errcode = 'P0001';
    end if;
    perform public.write_activity('fee.class_added', 'fee_class', cid::text, null,
      'Added fee tracking class "' || cname || '" under ' || bname,
      jsonb_build_object('batch_id', p_batch_id, 'class_name', cname));
    return cid;
  end if;

  if exists (
    select 1 from public.fee_classes
    where batch_id = p_batch_id and lower(name) = lower(cname) and id <> cid
  ) then
    raise exception 'Class "%" already exists in %.', cname, bname using errcode = 'P0001';
  end if;

  update public.fee_classes
     set batch_id = p_batch_id,
         name = cname,
         is_active = coalesce(p_is_active, true)
   where id = cid;
  if not found then
    raise exception 'Class not found.' using errcode = 'P0001';
  end if;

  perform public.write_activity('fee.class_changed', 'fee_class', cid::text, null,
    'Updated fee tracking class "' || cname || '" (' || bname || ')',
    jsonb_build_object('batch_id', p_batch_id, 'class_name', cname, 'is_active', coalesce(p_is_active, true)));
  return cid;
end;
$$;

-- Delete a class (cascades its imports, student snapshots and follow-ups).
create or replace function public.fee_class_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
begin
  if not public.has_page('fee_reminders', true) then
    raise exception 'You are not allowed to delete fee reminder classes.' using errcode = '42501';
  end if;
  select fc.id, fc.name, b.name as batch_name into c
    from public.fee_classes fc
    join public.batches b on b.id = fc.batch_id
   where fc.id = p_id;
  if c.id is null then
    raise exception 'Class not found.' using errcode = 'P0001';
  end if;
  delete from public.fee_classes where id = p_id;
  perform public.write_activity('fee.class_deleted', 'fee_class', p_id::text, null,
    'Deleted fee tracking class "' || c.name || '" (' || c.batch_name || ')',
    jsonb_build_object('class_name', c.name, 'batch_name', c.batch_name));
end;
$$;

-- Atomically replace one (class, month) paid student list. Follow-ups are untouched!
create or replace function public.fee_month_replace_import(
  p_class_id uuid,
  p_month date,
  p_file_name text,
  p_raw_count integer,
  p_duplicates_merged integer,
  p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  m date := date_trunc('month', p_month)::date;
  c record;
  r jsonb;
  inserted integer := 0;
  v_wa text;
  v_mob text;
  v_amt numeric;
begin
  if not public.has_page('fee_reminders', true) then
    raise exception 'You are not allowed to import monthly fee lists.' using errcode = '42501';
  end if;
  select fc.id, fc.name, b.name as batch_name into c
    from public.fee_classes fc
    join public.batches b on b.id = fc.batch_id
   where fc.id = p_class_id;
  if c.id is null then
    raise exception 'Class not found.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'Import at most 5,000 students per class and month.' using errcode = 'P0001';
  end if;

  delete from public.fee_month_students where class_id = p_class_id and month = m;

  for r in select value from jsonb_array_elements(p_rows) loop
    v_wa := nullif(trim(coalesce(r ->> 'whatsapp_norm', '')), '');
    v_mob := nullif(trim(coalesce(r ->> 'mobile_norm', '')), '');
    v_amt := nullif(trim(coalesce(r ->> 'amount', '')), '')::numeric;

    insert into public.fee_month_students (
      class_id, month, student_key, full_name,
      email_norm, raw_email, whatsapp_norm, raw_whatsapp,
      mobile_norm, raw_mobile, institute, district,
      is_new_student, amount, export_label, raw_classes
    )
    values (
      p_class_id,
      m,
      left(trim(coalesce(r ->> 'student_key', '')), 200),
      left(trim(coalesce(r ->> 'full_name', '')), 150),
      left(lower(trim(coalesce(r ->> 'email_norm', ''))), 200),
      left(trim(coalesce(r ->> 'raw_email', '')), 200),
      v_wa,
      left(trim(coalesce(r ->> 'raw_whatsapp', '')), 60),
      v_mob,
      left(trim(coalesce(r ->> 'raw_mobile', '')), 60),
      left(trim(coalesce(r ->> 'institute', '')), 100),
      left(trim(coalesce(r ->> 'district', '')), 100),
      coalesce((r ->> 'is_new_student')::boolean, false),
      v_amt,
      left(trim(coalesce(r ->> 'export_label', '')), 120),
      left(trim(coalesce(r ->> 'raw_classes', '')), 500)
    )
    on conflict (class_id, month, student_key) do nothing;
    if found then
      inserted := inserted + 1;
    end if;
  end loop;

  insert into public.fee_month_imports (
    class_id, month, file_name, raw_row_count, unique_student_count, duplicates_merged, uploaded_by, uploaded_at
  )
  values (
    p_class_id,
    m,
    left(coalesce(nullif(trim(p_file_name), ''), 'upload'), 200),
    greatest(coalesce(p_raw_count, inserted), inserted),
    inserted,
    greatest(coalesce(p_duplicates_merged, 0), 0),
    actor,
    now()
  )
  on conflict (class_id, month) do update set
    file_name            = excluded.file_name,
    raw_row_count        = excluded.raw_row_count,
    unique_student_count = excluded.unique_student_count,
    duplicates_merged    = excluded.duplicates_merged,
    uploaded_by          = excluded.uploaded_by,
    uploaded_at          = now();

  perform public.write_activity('fee.imported', 'fee_class', p_class_id::text, null,
    'Uploaded ' || inserted || ' paid student' || case when inserted = 1 then '' else 's' end
      || ' for ' || c.name || ' (' || public.month_name(m) || ')',
    jsonb_build_object(
      'class_id', p_class_id,
      'batch_name', c.batch_name,
      'month', m,
      'file_name', left(coalesce(p_file_name, ''), 120),
      'unique_students', inserted,
      'duplicates_merged', greatest(coalesce(p_duplicates_merged, 0), 0)
    ));
  return inserted;
end;
$$;

-- Remove one uploaded month snapshot for a class.
create or replace function public.fee_month_delete_import(p_class_id uuid, p_month date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m date := date_trunc('month', p_month)::date;
  c record;
begin
  if not public.has_page('fee_reminders', true) then
    raise exception 'You are not allowed to remove monthly fee lists.' using errcode = '42501';
  end if;
  select fc.id, fc.name into c from public.fee_classes fc where fc.id = p_class_id;
  if c.id is null then
    raise exception 'Class not found.' using errcode = 'P0001';
  end if;
  delete from public.fee_month_students where class_id = p_class_id and month = m;
  delete from public.fee_month_imports where class_id = p_class_id and month = m;
  perform public.write_activity('fee.import_deleted', 'fee_class', p_class_id::text, null,
    'Removed ' || public.month_name(m) || ' paid list for ' || c.name,
    jsonb_build_object('class_id', p_class_id, 'month', m));
end;
$$;

-- Record or update a WhatsApp follow-up / label / status for one due student.
create or replace function public.fee_followup_set(
  p_class_id uuid,
  p_due_month date,
  p_student_key text,
  p_student_name text,
  p_email_norm text,
  p_whatsapp_norm text,
  p_status text,
  p_label text default null,
  p_note text default null,
  p_template_id uuid default null,
  p_increment_message boolean default false
)
returns public.fee_due_followups
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  m date := date_trunc('month', p_due_month)::date;
  key text := left(trim(coalesce(p_student_key, '')), 200);
  v_wa text := nullif(trim(coalesce(p_whatsapp_norm, '')), '');
  out_row public.fee_due_followups;
begin
  if not public.has_page('fee_reminders', true) then
    raise exception 'You are not allowed to update fee follow-ups.' using errcode = '42501';
  end if;
  if char_length(key) < 2 then
    raise exception 'Invalid student key.' using errcode = 'P0001';
  end if;
  if p_status is null or p_status not in ('pending', 'messaged', 'excused', 'dropped') then
    raise exception 'Unknown follow-up status.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.fee_classes where id = p_class_id) then
    raise exception 'Class not found.' using errcode = 'P0001';
  end if;

  insert into public.fee_due_followups (
    class_id, due_month, student_key, student_name, email_norm, whatsapp_norm,
    status, label, message_count, last_messaged_at, last_messaged_by, last_template_id,
    note, updated_by, updated_at
  )
  values (
    p_class_id,
    m,
    key,
    left(trim(coalesce(p_student_name, '')), 150),
    left(lower(trim(coalesce(p_email_norm, ''))), 200),
    v_wa,
    p_status,
    left(trim(coalesce(p_label, '')), 80),
    case when coalesce(p_increment_message, false) then 1 else 0 end,
    case when coalesce(p_increment_message, false) then now() else null end,
    case when coalesce(p_increment_message, false) then actor else null end,
    case when coalesce(p_increment_message, false) then p_template_id else null end,
    left(trim(coalesce(p_note, '')), 500),
    actor,
    now()
  )
  on conflict (class_id, due_month, student_key) do update set
    student_name     = case when excluded.student_name <> '' then excluded.student_name else fee_due_followups.student_name end,
    email_norm       = case when excluded.email_norm <> '' then excluded.email_norm else fee_due_followups.email_norm end,
    whatsapp_norm    = coalesce(excluded.whatsapp_norm, fee_due_followups.whatsapp_norm),
    status           = excluded.status,
    label            = case when p_label is not null then left(trim(p_label), 80) else fee_due_followups.label end,
    note             = case when p_note is not null then left(trim(p_note), 500) else fee_due_followups.note end,
    message_count    = fee_due_followups.message_count + case when coalesce(p_increment_message, false) then 1 else 0 end,
    last_messaged_at = case when coalesce(p_increment_message, false) then now() else fee_due_followups.last_messaged_at end,
    last_messaged_by = case when coalesce(p_increment_message, false) then actor else fee_due_followups.last_messaged_by end,
    last_template_id = case when coalesce(p_increment_message, false) then coalesce(p_template_id, fee_due_followups.last_template_id) else fee_due_followups.last_template_id end,
    updated_by       = actor,
    updated_at       = now()
  returning * into out_row;

  return out_row;
end;
$$;

-- Create or update a WhatsApp message template.
create or replace function public.fee_template_save(
  p_id uuid,
  p_name text,
  p_body text,
  p_is_default boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  tname text := trim(coalesce(p_name, ''));
  tbody text := trim(coalesce(p_body, ''));
  tid uuid := p_id;
  make_default boolean := coalesce(p_is_default, false);
begin
  if not public.has_page('fee_reminders', true) then
    raise exception 'You are not allowed to edit WhatsApp templates.' using errcode = '42501';
  end if;
  if char_length(tname) < 2 or char_length(tname) > 80 then
    raise exception 'Template name must be 2–80 characters.' using errcode = 'P0001';
  end if;
  if char_length(tbody) < 5 or char_length(tbody) > 3000 then
    raise exception 'Template message must be 5–3,000 characters.' using errcode = 'P0001';
  end if;

  -- If there are no templates yet, the first one becomes default.
  if not make_default and not exists (select 1 from public.fee_message_templates where is_default and (tid is null or id <> tid)) then
    make_default := true;
  end if;

  if make_default then
    update public.fee_message_templates set is_default = false where is_default and (tid is null or id <> tid);
  end if;

  if tid is null then
    insert into public.fee_message_templates (name, body, is_default, created_by, updated_by)
    values (tname, tbody, make_default, actor, actor)
    on conflict (lower(name)) do nothing
    returning id into tid;
    if tid is null then
      raise exception 'A template named "%" already exists.', tname using errcode = 'P0001';
    end if;
    perform public.write_activity('fee.template_saved', 'fee_template', tid::text, null,
      'Created WhatsApp template "' || tname || '"', jsonb_build_object('name', tname));
    return tid;
  end if;

  if exists (select 1 from public.fee_message_templates where lower(name) = lower(tname) and id <> tid) then
    raise exception 'A template named "%" already exists.', tname using errcode = 'P0001';
  end if;

  update public.fee_message_templates
     set name = tname,
         body = tbody,
         is_default = make_default,
         updated_by = actor,
         updated_at = now()
   where id = tid;
  if not found then
    raise exception 'Template not found.' using errcode = 'P0001';
  end if;

  perform public.write_activity('fee.template_saved', 'fee_template', tid::text, null,
    'Updated WhatsApp template "' || tname || '"', jsonb_build_object('name', tname));
  return tid;
end;
$$;

-- Delete a WhatsApp template (promotes another if the default was deleted).
create or replace function public.fee_template_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
begin
  if not public.has_page('fee_reminders', true) then
    raise exception 'You are not allowed to delete WhatsApp templates.' using errcode = '42501';
  end if;
  select id, name, is_default into t from public.fee_message_templates where id = p_id;
  if t.id is null then
    raise exception 'Template not found.' using errcode = 'P0001';
  end if;
  delete from public.fee_message_templates where id = p_id;
  if t.is_default then
    update public.fee_message_templates
       set is_default = true
     where id = (select id from public.fee_message_templates order by created_at limit 1);
  end if;
  perform public.write_activity('fee.template_deleted', 'fee_template', p_id::text, null,
    'Deleted WhatsApp template "' || t.name || '"', jsonb_build_object('name', t.name));
end;
$$;

-- Privacy-safe concession cross-labels for a batch: only returns data when the caller
-- also has access to the Concession students page.
create or replace function public.fee_batch_concession_labels(p_batch_id uuid)
returns table (full_name text, card_type text, status text, phones text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_page('fee_reminders') or not public.has_page('students') then
    return;
  end if;
  return query
    select s.full_name,
           s.card_type,
           s.status,
           coalesce(
             (select array_agg(g.phone) from public.concession_guardians g where g.student_id = s.id and g.phone is not null),
             '{}'::text[]
           )
      from public.concession_students s
     where s.batch_id = p_batch_id
       and s.status <> 'ended';
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Row Level Security & Grants
-- -----------------------------------------------------------------------------
alter table public.fee_classes           enable row level security;
alter table public.fee_month_imports     enable row level security;
alter table public.fee_month_students    enable row level security;
alter table public.fee_due_followups     enable row level security;
alter table public.fee_message_templates enable row level security;

drop policy if exists "fee_classes: page read" on public.fee_classes;
create policy "fee_classes: page read" on public.fee_classes for select to authenticated
  using ((select public.has_page('fee_reminders')));

drop policy if exists "fee_month_imports: page read" on public.fee_month_imports;
create policy "fee_month_imports: page read" on public.fee_month_imports for select to authenticated
  using ((select public.has_page('fee_reminders')));

drop policy if exists "fee_month_students: page read" on public.fee_month_students;
create policy "fee_month_students: page read" on public.fee_month_students for select to authenticated
  using ((select public.has_page('fee_reminders')));

drop policy if exists "fee_due_followups: page read" on public.fee_due_followups;
create policy "fee_due_followups: page read" on public.fee_due_followups for select to authenticated
  using ((select public.has_page('fee_reminders')));

drop policy if exists "fee_message_templates: page read" on public.fee_message_templates;
create policy "fee_message_templates: page read" on public.fee_message_templates for select to authenticated
  using ((select public.has_page('fee_reminders')));

revoke all on table public.fee_classes, public.fee_month_imports, public.fee_month_students,
  public.fee_due_followups, public.fee_message_templates from anon, authenticated;
grant select on table public.fee_classes, public.fee_month_imports, public.fee_month_students,
  public.fee_due_followups, public.fee_message_templates to authenticated;

revoke all on function public.fee_class_save(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.fee_class_delete(uuid) from public, anon, authenticated;
revoke all on function public.fee_month_replace_import(uuid, date, text, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function public.fee_month_delete_import(uuid, date) from public, anon, authenticated;
revoke all on function public.fee_followup_set(uuid, date, text, text, text, text, text, text, text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.fee_template_save(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.fee_template_delete(uuid) from public, anon, authenticated;
revoke all on function public.fee_batch_concession_labels(uuid) from public, anon, authenticated;

grant execute on function public.fee_class_save(uuid, uuid, text, boolean) to authenticated;
grant execute on function public.fee_class_delete(uuid) to authenticated;
grant execute on function public.fee_month_replace_import(uuid, date, text, integer, integer, jsonb) to authenticated;
grant execute on function public.fee_month_delete_import(uuid, date) to authenticated;
grant execute on function public.fee_followup_set(uuid, date, text, text, text, text, text, text, text, uuid, boolean) to authenticated;
grant execute on function public.fee_template_save(uuid, text, text, boolean) to authenticated;
grant execute on function public.fee_template_delete(uuid) to authenticated;
grant execute on function public.fee_batch_concession_labels(uuid) to authenticated;
