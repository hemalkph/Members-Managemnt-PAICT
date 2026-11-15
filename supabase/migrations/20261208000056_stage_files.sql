-- =============================================================================
-- Several files per paper stage. Safe to run more than once.
--   * Every file keeps showing (a new upload no longer pushes the old one down).
--   * Each file has a tag (question paper, images, corrected paper…) and a remark.
--   * The stage owner marks one file per stage as the correct paper; the next
--     stages see it first, and the Paper library uses it.
--   * After finishing, the owner can still add files and tell the next stages.
-- =============================================================================

alter table public.paper_files add column if not exists tag text not null default 'other';
alter table public.paper_files add column if not exists is_main boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'paper_files_tag_check') then
    alter table public.paper_files add constraint paper_files_tag_check
      check (tag in ('paper', 'corrected', 'images', 'answers', 'marked', 'source', 'final', 'other'));
  end if;
end $$;

-- Existing files: a tag from their stage (images by extension), and the latest
-- file of each stage becomes the correct paper – what the app used until now.
update public.paper_files set tag = case
    when file_name ~* '\.(png|jpe?g|gif|webp|svg|heic|tiff?)$' then 'images'
    when stage in ('review_si', 'review_en') then 'marked'
    when stage = 'handover' then 'final'
    when stage in ('scheme', 'scheme_rewrite', 'scheme_en') then 'answers'
    else 'paper'
  end
where tag = 'other';

create unique index if not exists paper_files_one_main_idx on public.paper_files (paper_id, stage) where is_main;

update public.paper_files f set is_main = true
where not exists (select 1 from public.paper_files m where m.paper_id = f.paper_id and m.stage = f.stage and m.is_main)
  and f.version = (select max(version) from public.paper_files l where l.paper_id = f.paper_id and l.stage = f.stage);

-- Papers page editors, or the stage's owner once the stage has started.
create or replace function public.can_manage_stage_files(p_paper uuid, p_stage text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_page('papers', true)
      or (public.is_active_member() and exists (
            select 1 from public.paper_stages ps
            where ps.paper_id = p_paper and ps.stage = p_stage
              and ps.owner_id = (select auth.uid()) and ps.status in ('in_progress', 'done')
          ));
$$;

-- The owner marks the correct paper of their stage (one per stage).
create or replace function public.set_main_paper_file(p_file uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f record;
begin
  select paper_id, stage into f from public.paper_files where id = p_file;
  if not found then
    raise exception 'File not found.';
  end if;
  if not public.can_manage_stage_files(f.paper_id, f.stage) then
    raise exception 'Only the stage owner can choose the correct paper.' using errcode = '42501';
  end if;
  update public.paper_files set is_main = false where paper_id = f.paper_id and stage = f.stage and is_main and id <> p_file;
  update public.paper_files set is_main = true where id = p_file;
end;
$$;

-- The stages that use a stage's work (mirrors STAGE_INPUTS in lib/papers).
create or replace function public.next_paper_stages(p_stage text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_stage
    when 'create_si' then array['typeset_si', 'convert']
    when 'typeset_si' then array['review_si', 'handover']
    when 'convert' then array['typeset_en']
    when 'typeset_en' then array['review_en', 'handover']
    when 'review_si' then array['handover']
    when 'review_en' then array['handover']
    when 'handover' then array['scheme']
    when 'scheme' then array['scheme_rewrite', 'scheme_en']
    else array[]::text[]
  end;
$$;

create or replace function public.paper_file_tag_label(p_tag text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_tag
    when 'paper' then 'Question paper'
    when 'corrected' then 'Corrected paper'
    when 'images' then 'Images'
    when 'answers' then 'Answers'
    when 'marked' then 'Marked PDF'
    when 'source' then 'Source file'
    when 'final' then 'Final PDF'
    else 'File'
  end;
$$;

-- Tell the owners of the next stages about new files. Returns how many were told.
create or replace function public.notify_stage_files(p_paper uuid, p_stage text, p_files uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  paper_title text;
  summary text;
  n integer;
  told integer := 0;
  who record;
begin
  if not public.can_manage_stage_files(p_paper, p_stage) then
    raise exception 'Only the stage owner can send this.' using errcode = '42501';
  end if;
  select count(*), string_agg(
           public.paper_file_tag_label(tag) || case when is_main then ' (correct paper)' else '' end
             || ': ' || file_name || coalesce(' – ' || note, ''),
           '; ' order by is_main desc, created_at)
    into n, summary
  from public.paper_files
  where paper_id = p_paper and stage = p_stage and id = any (p_files);
  if n = 0 then
    return 0;
  end if;
  select title into paper_title from public.papers where id = p_paper;

  for who in
    select distinct ps.owner_id from public.paper_stages ps
    where ps.paper_id = p_paper and ps.stage = any (public.next_paper_stages(p_stage))
      and ps.status <> 'skipped' and ps.owner_id is not null and ps.owner_id <> (select auth.uid())
  loop
    perform public.notify(who.owner_id, 'paper.files',
      'New files: ' || paper_title || ' – ' || public.stage_label(p_stage),
      coalesce(public.profile_name((select auth.uid())), 'Someone') || ' added ' || n
        || case when n = 1 then ' file. ' else ' files. ' end || summary,
      '/papers/' || p_paper::text);
    told := told + 1;
  end loop;
  return told;
end;
$$;

-- The library prefers the correct paper, then the newest file.
create or replace function public.paper_library()
returns table (
  file_id uuid, paper_id uuid, title text, kind text, part text, medium text, exam_day date,
  exam_name text, batch_name text, stage text, version integer, file_name text, size_bytes bigint,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (f.paper_id, f.stage)
         f.id, p.id, p.title, p.kind, p.part, p.medium, p.exam_day, e.name, b.name,
         f.stage, f.version, f.file_name, f.size_bytes, f.created_at
  from public.paper_files f
  join public.papers p on p.id = f.paper_id
  left join public.exams e on e.id = p.exam_id
  left join public.batches b on b.id = e.batch_id
  where (public.is_active_member() or public.is_admin())
    and f.stage in ('typeset_si', 'typeset_en', 'handover', 'scheme', 'scheme_rewrite', 'scheme_en')
    and public.library_file_ok(f.paper_id, f.stage)
  order by f.paper_id, f.stage, f.is_main desc, f.version desc;
$$;

revoke all on function public.can_manage_stage_files(uuid, text) from public, anon;
revoke all on function public.set_main_paper_file(uuid) from public, anon;
revoke all on function public.notify_stage_files(uuid, text, uuid[]) from public, anon;
revoke all on function public.next_paper_stages(text) from public, anon;
revoke all on function public.paper_file_tag_label(text) from public, anon;
grant execute on function public.can_manage_stage_files(uuid, text) to authenticated;
grant execute on function public.set_main_paper_file(uuid) to authenticated;
grant execute on function public.notify_stage_files(uuid, text, uuid[]) to authenticated;
grant execute on function public.paper_library() to authenticated;
