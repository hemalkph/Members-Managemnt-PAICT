-- Paper library. Safe to run twice.
--   * A paper appears once its reviews are finished: the reviewed Sinhala and
--     English papers (latest type set versions) and the hand-over PDF.
--   * Its marking schemes appear once every marking-scheme step (Sinhala,
--     clear copy, English) is finished.
-- Every active member can open these files; drafts stay with the paper's team.

-- Is this stage's file ready for the library?
create or replace function public.library_file_ok(p_paper uuid, p_stage text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.papers p where p.id = p_paper and p.status <> 'cancelled')
     and case
       when p_stage in ('typeset_si', 'typeset_en', 'handover') then
         -- Everything up to and including the reviews is finished (done or skipped), and some of it was done.
         not exists (select 1 from public.paper_stages s
                     where s.paper_id = p_paper and s.position <= 6 and s.status in ('waiting', 'in_progress'))
         and exists (select 1 from public.paper_stages s
                     where s.paper_id = p_paper and s.position <= 6 and s.status = 'done')
       when p_stage in ('scheme', 'scheme_rewrite', 'scheme_en') then
         not exists (select 1 from public.paper_stages s
                     where s.paper_id = p_paper and s.stage in ('scheme', 'scheme_rewrite', 'scheme_en')
                       and s.status in ('waiting', 'in_progress'))
         and exists (select 1 from public.paper_stages s
                     where s.paper_id = p_paper and s.stage in ('scheme', 'scheme_rewrite', 'scheme_en')
                       and s.status = 'done')
       else false
     end;
$$;

-- The library: the latest file of each ready stage, for every active member.
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
  order by f.paper_id, f.stage, f.version desc;
$$;

-- Opening a file follows the same rule (rows and storage objects).
drop policy if exists "paper_files: final outputs for members" on public.paper_files;
drop policy if exists "paper_files: library for members" on public.paper_files;
create policy "paper_files: library for members" on public.paper_files for select to authenticated
  using (public.is_active_member() and public.library_file_ok(paper_id, stage));

drop policy if exists "papers bucket: final outputs for members" on storage.objects;
drop policy if exists "papers bucket: library for members" on storage.objects;
create policy "papers bucket: library for members"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'papers'
    and public.is_active_member()
    and public.library_file_ok(nullif((storage.foldername(name))[1], '')::uuid, (storage.foldername(name))[2])
  );

revoke all on function public.library_file_ok(uuid, text) from public, anon;
revoke all on function public.paper_library() from public, anon;
grant execute on function public.library_file_ok(uuid, text) to authenticated;
grant execute on function public.paper_library() to authenticated;
