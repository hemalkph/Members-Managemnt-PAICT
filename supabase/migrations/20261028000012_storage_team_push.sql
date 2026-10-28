-- =============================================================================
-- 1. Paper file clean-up: draft files are deleted N days after hand-over
--    (default 14, main admins can change it) and admins see storage use.
-- 2. Team performance: when a paper stage really started (started_at).
-- 3. Phone notifications: push subscriptions, and every new notification is
--    handed to the app (/api/hooks/push), which sends it to the person's phones.
--
-- The database calls the app with pg_net. The app's address and a shared
-- secret are kept in Supabase Vault (added once, separately – see the setup
-- notes); until then nothing is sent and nothing breaks.
-- (No DROP statements, so it runs without confirmation.)
-- =============================================================================

create extension if not exists pg_net with schema extensions;

-- -----------------------------------------------------------------------------
-- Settings and columns
-- -----------------------------------------------------------------------------
alter table public.app_settings add column if not exists paper_file_days integer not null default 14;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_settings_paper_file_days_check') then
    alter table public.app_settings
      add constraint app_settings_paper_file_days_check check (paper_file_days between 1 and 365);
  end if;
end;
$$;

-- When the paper's draft files were cleared, and how many.
alter table public.papers add column if not exists files_cleared_at timestamptz;
alter table public.papers add column if not exists files_cleared_count integer;

-- When a stage actually started (for "average days per stage").
alter table public.paper_stages add column if not exists started_at timestamptz;
update public.paper_stages ps
set started_at = coalesce(
  (select t.created_at from public.tasks t where t.paper_stage_id = ps.id limit 1),
  ps.start_date::timestamptz
)
where ps.started_at is null and ps.status in ('in_progress', 'done');

-- Start every stage whose earlier stages are finished (same as before, now
-- also stamps started_at).
create or replace function public.advance_paper(p_paper uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_stage record;
  paper_title text;
  admin_row record;
begin
  select title into paper_title from public.papers where id = p_paper and status = 'in_progress';
  if paper_title is null then
    return;
  end if;

  for next_stage in
    select ps.* from public.paper_stages ps
    where ps.paper_id = p_paper and ps.status = 'waiting'
      and not exists (
        select 1 from public.paper_stages dep
        where dep.paper_id = p_paper
          and dep.stage = any (public.stage_deps(ps.stage))
          and dep.status not in ('done', 'skipped')
      )
    order by ps.position
  loop
    update public.paper_stages set status = 'in_progress', started_at = now() where id = next_stage.id;
    update public.tasks set status = 'open' where paper_stage_id = next_stage.id and status = 'waiting';

    if next_stage.owner_id is null then
      for admin_row in select id from public.profiles where is_admin and is_active loop
        perform public.notify(admin_row.id, 'paper.unassigned',
          public.stage_label(next_stage.stage) || ' has no owner: "' || paper_title || '"',
          'Choose who does this stage.', '/papers/' || p_paper::text,
          'paper-unassigned:' || next_stage.id::text);
      end loop;
    end if;
  end loop;

  if not exists (
    select 1 from public.paper_stages where paper_id = p_paper and status in ('waiting', 'in_progress')
  ) then
    update public.papers set status = 'done', completed_at = now() where id = p_paper and status = 'in_progress';
    perform public.write_activity('paper.done', 'paper', p_paper::text, null,
      'Finished "' || paper_title || '" (all stages done)', jsonb_build_object('paper_id', p_paper));
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Storage use (admins)
-- -----------------------------------------------------------------------------
create or replace function public.storage_usage()
returns table (bucket text, files bigint, bytes bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can see storage use.' using errcode = '42501';
  end if;
  return query
    select o.bucket_id::text, count(*)::bigint, coalesce(sum((o.metadata ->> 'size')::bigint), 0)::bigint
    from storage.objects o
    group by o.bucket_id
    order by 3 desc;
end;
$$;

-- Main admins: how many days after hand-over paper files are kept.
create or replace function public.set_paper_file_days(p_days integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_main_admin() then
    raise exception 'Only main admins can change this.' using errcode = '42501';
  end if;
  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'Choose between 1 and 365 days.' using errcode = 'P0001';
  end if;
  update public.app_settings set paper_file_days = p_days, updated_by = (select auth.uid()), updated_at = now();
  perform public.write_activity('settings.paper_files', 'settings', 'paper_file_days', null,
    'Paper files are now kept ' || p_days || ' days after hand-over', jsonb_build_object('days', p_days));
end;
$$;

-- -----------------------------------------------------------------------------
-- Phone notifications: one row per phone / browser
-- -----------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  endpoint   text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh     text not null check (char_length(p256dh) <= 200),
  auth       text not null check (char_length(auth) <= 100),
  device     text check (char_length(device) <= 120),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon;
revoke update, truncate on public.push_subscriptions from authenticated;

create policy "push_subscriptions: read own" on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
create policy "push_subscriptions: add own" on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_active_member());
create policy "push_subscriptions: remove own" on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- Calling the app from the database (address + secret from Vault)
-- -----------------------------------------------------------------------------
create or replace function public.call_app_hook(p_path text, p_body jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_url text;
  secret text;
begin
  select decrypted_secret into base_url from vault.decrypted_secrets where name = 'app_hook_url' limit 1;
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'app_hook_secret' limit 1;
  if base_url is null or secret is null then
    return; -- not set up yet
  end if;
  perform net.http_post(
    url := rtrim(base_url, '/') || p_path,
    body := coalesce(p_body, '{}'::jsonb),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    timeout_milliseconds := 5000
  );
exception when others then
  -- A notification must never fail because the app couldn't be reached.
  raise warning 'call_app_hook(%) failed: %', p_path, sqlerrm;
end;
$$;

-- New (or grouped and bumped) notification → send it to the person's phones.
create or replace function public.push_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.read_at is not null then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.created_at is not distinct from old.created_at then
    return null; -- e.g. marked as read; only grouped messages that were bumped are sent again
  end if;
  if exists (select 1 from public.push_subscriptions where user_id = new.user_id) then
    perform public.call_app_hook('/api/hooks/push', jsonb_build_object('notification_id', new.id));
  end if;
  return null;
end;
$$;

create or replace trigger notifications_push
  after insert or update of created_at on public.notifications
  for each row execute function public.push_notification();

-- Daily at 01:30 Sri Lanka time: delete paper files that are past their keep time.
select cron.schedule(
  'paper-file-cleanup',
  '0 20 * * *',
  $$ select public.call_app_hook('/api/hooks/cleanup', '{}'::jsonb); $$
);

-- -----------------------------------------------------------------------------
-- Permissions
-- -----------------------------------------------------------------------------
revoke execute on function public.call_app_hook(text, jsonb) from public, anon, authenticated;
revoke execute on function public.push_notification() from public, anon, authenticated;
revoke execute on function public.storage_usage() from public, anon;
revoke execute on function public.set_paper_file_days(integer) from public, anon;
grant execute on function public.storage_usage() to authenticated;
grant execute on function public.set_paper_file_days(integer) to authenticated;
