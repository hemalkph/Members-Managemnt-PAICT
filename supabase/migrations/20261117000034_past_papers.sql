-- Past papers. Safe to run twice.
-- Papers made and marked before the system existed: added as already finished
-- (every production stage skipped, no tasks, nobody paid for making them) and
-- handed over now, so the marking team can pick them in "Log marking".

create or replace function public.paper_add_past(
  p_title text,
  p_part text,
  p_medium text,
  p_exam_day date default null,
  p_exam uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paper uuid;
begin
  if not public.has_page('papers', true) then
    raise exception 'Only people who can edit Papers can add past papers.' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_title, ''))) not between 2 and 150 then
    raise exception 'Give the paper a name (2–150 letters).' using errcode = 'P0001';
  end if;
  if p_part not in ('mcq', 'essay', 'full') then
    raise exception 'Choose the paper part.' using errcode = 'P0001';
  end if;
  if p_medium not in ('si', 'both') then
    raise exception 'Choose the medium.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.papers
    where kind = 'paper' and status <> 'cancelled' and lower(trim(title)) = lower(trim(p_title))
  ) then
    raise exception 'A paper called "%" is already in the system.', trim(p_title) using errcode = 'P0001';
  end if;

  insert into public.papers (title, kind, exam_id, notes, created_by, medium, part, exam_day,
                             status, completed_at, handed_over_at)
  values (trim(p_title), 'paper', p_exam, 'Past paper – made before the system.', (select auth.uid()),
          p_medium, p_part, p_exam_day, 'done', now(), now())
  returning id into v_paper;

  insert into public.paper_stages (paper_id, stage, position, status)
  select v_paper, v.stage, v.position, 'skipped'
  from (values
    ('create_si', 1), ('typeset_si', 2), ('convert', 3), ('typeset_en', 4),
    ('review_si', 5), ('review_en', 6), ('handover', 7),
    ('scheme', 8), ('scheme_rewrite', 9), ('scheme_en', 10), ('mark', 11)
  ) as v(stage, position);

  perform public.write_activity('paper.created', 'paper', v_paper::text, null,
    'Added the past paper "' || trim(p_title) || '" for marking',
    jsonb_build_object('paper_id', v_paper, 'part', p_part, 'past', true));
  return v_paper;
end;
$$;

revoke all on function public.paper_add_past(text, text, text, date, uuid) from public, anon, authenticated;
grant execute on function public.paper_add_past(text, text, text, date, uuid) to authenticated;
