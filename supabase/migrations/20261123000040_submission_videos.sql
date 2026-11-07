-- =============================================================================
-- Video editors log work by ticking the videos they edited in the team's
-- Google Drive folder (Social Media Videos → <month> → Edited / External edits).
-- The videos stay in Drive; this table only records which work entry claims
-- which Drive file. The server checks every file with Google before saving.
-- A video can only be claimed by one work entry that wasn't rejected.
-- Same access rules as submission_attachments. Safe to run twice.
-- =============================================================================

create table if not exists public.submission_videos (
  id             uuid primary key default gen_random_uuid(),
  submission_id  uuid not null references public.submissions (id) on delete cascade,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  drive_file_id  text not null check (drive_file_id ~ '^[A-Za-z0-9_-]{10,100}$'),
  name           text not null check (char_length(name) between 1 and 300),
  source         text not null check (source in ('edited', 'external')),
  folder_name    text check (char_length(folder_name) <= 100),
  mime_type      text,
  size_bytes     bigint check (size_bytes >= 0),
  duration_ms    integer check (duration_ms >= 0),
  created_at     timestamptz not null default now(),
  unique (submission_id, drive_file_id)
);

create index if not exists submission_videos_user_idx on public.submission_videos (user_id);
create index if not exists submission_videos_file_idx on public.submission_videos (drive_file_id);

alter table public.submission_videos enable row level security;
revoke all on public.submission_videos from anon;
grant select, insert, delete on public.submission_videos to authenticated;

drop policy if exists "videos: read own" on public.submission_videos;
create policy "videos: read own"
  on public.submission_videos for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "videos: add to own pending submission" on public.submission_videos;
create policy "videos: add to own pending submission"
  on public.submission_videos for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.submissions s
      where s.id = submission_videos.submission_id
        and s.user_id = (select auth.uid())
        and s.status = 'pending'
    )
  );

drop policy if exists "videos: remove from own pending submission" on public.submission_videos;
create policy "videos: remove from own pending submission"
  on public.submission_videos for delete to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.submissions s
      where s.id = submission_videos.submission_id
        and s.user_id = (select auth.uid())
        and s.status = 'pending'
    )
  );

drop policy if exists "videos: admins manage" on public.submission_videos;
create policy "videos: admins manage"
  on public.submission_videos for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- One claim per video (rejected work frees it again).
create or replace function public.check_video_not_claimed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.submission_videos v
    join public.submissions s on s.id = v.submission_id
    where v.drive_file_id = new.drive_file_id
      and v.submission_id <> new.submission_id
      and s.status <> 'rejected'
  ) then
    raise exception '“%” is already logged in another work entry.', new.name using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists submission_videos_not_claimed on public.submission_videos;
create trigger submission_videos_not_claimed
  before insert on public.submission_videos
  for each row execute function public.check_video_not_claimed();

-- Which of these Drive videos are already claimed (by any member), so the picker
-- can show "Already logged". p_submission: the entry being edited (its own claims don't count).
create or replace function public.claimed_drive_videos(p_ids text[], p_submission uuid default null)
returns table (drive_file_id text, mine boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (v.drive_file_id) v.drive_file_id, v.user_id = (select auth.uid())
  from public.submission_videos v
  join public.submissions s on s.id = v.submission_id
  where v.drive_file_id = any (p_ids)
    and s.status <> 'rejected'
    and v.submission_id is distinct from p_submission
  order by v.drive_file_id, v.created_at;
$$;

revoke execute on function public.check_video_not_claimed() from public, anon, authenticated;
revoke execute on function public.claimed_drive_videos(text[], uuid) from public, anon;
grant execute on function public.claimed_drive_videos(text[], uuid) to authenticated;
