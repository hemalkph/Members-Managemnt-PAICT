-- =============================================================================
-- Paper library → tell the Physical Coordinator (print it) and the LMS Admin
-- (add it to the LMS) when a question paper reaches the library: the Sinhala
-- or English paper after its review, and the final hand-over PDF.
-- One notification per person, paper and language (dedupe key), so a stage
-- that is reopened and done again doesn't send it twice. Safe to run twice.
-- =============================================================================

-- shortcut: people are found by role name (LMS Admin / Physical Coordinator);
-- renaming those roles stops the notifications. Upgrade to a setting if that happens.
create or replace function public.notify_library_paper(p_paper uuid, p_stage text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  paper_title text;
  label text;
  who record;
begin
  if p_stage not in ('typeset_si', 'typeset_en', 'handover') then
    return;
  end if;
  if not exists (select 1 from public.paper_files where paper_id = p_paper and stage = p_stage)
     or not public.library_file_ok(p_paper, p_stage) then
    return;
  end if;

  select title into paper_title from public.papers where id = p_paper;
  label := paper_title || ' – ' || case p_stage when 'typeset_si' then 'Sinhala' when 'typeset_en' then 'English' else 'final PDF' end;

  for who in
    select distinct mr.user_id, case when r.name ilike '%lms%' then 'lms' else 'print' end as job
    from public.member_roles mr
    join public.roles r on r.id = mr.role_id
    where r.name ilike '%lms%admin%' or r.name ilike '%physical%coordinator%'
  loop
    perform public.notify(
      who.user_id,
      'library.new',
      'New in the paper library: ' || label,
      case who.job
        when 'lms' then 'Download it and add it to the LMS.'
        else 'Download it and send it for printing.'
      end,
      '/library',
      'library:' || who.job || ':' || p_paper || ':' || p_stage
    );
  end loop;
end;
$$;

-- A review (or the type setting it waits for) finished → the paper may now be in the library.
create or replace function public.library_stage_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('done', 'skipped') and old.status is distinct from new.status then
    if new.stage in ('typeset_si', 'review_si') then perform public.notify_library_paper(new.paper_id, 'typeset_si'); end if;
    if new.stage in ('typeset_en', 'review_en') then perform public.notify_library_paper(new.paper_id, 'typeset_en'); end if;
    if new.position <= 6 then perform public.notify_library_paper(new.paper_id, 'handover'); end if;
  end if;
  return null;
end;
$$;

create or replace trigger paper_stages_library_notify
  after update of status on public.paper_stages
  for each row execute function public.library_stage_notify();

-- A file uploaded after the review (e.g. the hand-over PDF) → the same check.
create or replace function public.library_file_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.notify_library_paper(new.paper_id, new.stage);
  return null;
end;
$$;

create or replace trigger paper_files_library_notify
  after insert on public.paper_files
  for each row execute function public.library_file_notify();

revoke execute on function public.notify_library_paper(uuid, text) from public, anon, authenticated;
revoke execute on function public.library_stage_notify() from public, anon, authenticated;
revoke execute on function public.library_file_notify() from public, anon, authenticated;
