-- =============================================================================
-- Stage times: each paper stage can have a start and a due time (Sri Lanka),
-- set from the paper's work window. The dates stay in step so reminders, the
-- exam countdown and days-off warnings keep working. Safe to run twice.
--
--   paper_stages.start_at / due_at   Times (null = whole day, due at 23:59).
--   paper_stages_sync_times          A new time sets its date; a date-only edit keeps
--                                    the old time of day.
--   paper_stages_set_times           Save times for a paper's stages (and the stage
--                                    tasks' due dates).
-- =============================================================================

alter table public.paper_stages
  add column if not exists start_at timestamptz,
  add column if not exists due_at   timestamptz;

create or replace function public.paper_stages_sync_times()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  is_update boolean := tg_op = 'UPDATE';
begin
  -- Due
  if new.due_at is not null and (not is_update or new.due_at is distinct from old.due_at) then
    new.due_date := (new.due_at at time zone 'Asia/Colombo')::date;
  elsif is_update and new.due_date is distinct from old.due_date then
    if new.due_date is null then
      new.due_at := null;
    elsif old.due_at is not null then
      new.due_at := (new.due_date + (old.due_at at time zone 'Asia/Colombo')::time) at time zone 'Asia/Colombo';
    end if;
  end if;
  -- Start
  if new.start_at is not null and (not is_update or new.start_at is distinct from old.start_at) then
    new.start_date := (new.start_at at time zone 'Asia/Colombo')::date;
  elsif is_update and new.start_date is distinct from old.start_date then
    if new.start_date is null then
      new.start_at := null;
    elsif old.start_at is not null then
      new.start_at := (new.start_date + (old.start_at at time zone 'Asia/Colombo')::time) at time zone 'Asia/Colombo';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists paper_stages_sync_times on public.paper_stages;
create trigger paper_stages_sync_times
  before insert or update of start_date, due_date, start_at, due_at on public.paper_stages
  for each row execute function public.paper_stages_sync_times();

create or replace function public.paper_stages_set_times(p_paper uuid, p_times jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  k text;
  v jsonb;
  s_at timestamptz;
  d_at timestamptz;
  stage_id uuid;
  n integer := 0;
  v_title text;
begin
  if not (public.is_admin() or public.has_page('papers', true)) then
    raise exception 'You are not allowed to change stage times.' using errcode = '42501';
  end if;
  select p.title into v_title from public.papers p where p.id = p_paper;
  if v_title is null then
    raise exception 'Paper not found.' using errcode = 'P0001';
  end if;
  if p_times is null or jsonb_typeof(p_times) <> 'object' then
    raise exception 'Check the stage times.' using errcode = 'P0001';
  end if;

  for k, v in select key, value from jsonb_each(p_times) loop
    begin
      s_at := (v ->> 'start_at')::timestamptz;
      d_at := (v ->> 'due_at')::timestamptz;
    exception when others then
      raise exception 'Check the stage times.' using errcode = 'P0001';
    end;
    if s_at is null or d_at is null or s_at > d_at then
      raise exception 'Check the stage times.' using errcode = 'P0001';
    end if;

    stage_id := null;
    select ps.id into stage_id from public.paper_stages ps
    where ps.paper_id = p_paper and ps.stage = k and ps.status <> 'skipped';
    continue when stage_id is null;

    update public.paper_stages set start_at = s_at, due_at = d_at where id = stage_id;
    update public.tasks t
    set due_date = (d_at at time zone 'Asia/Colombo')::date
    where t.paper_stage_id = stage_id and t.status not in ('done', 'cancelled');
    n := n + 1;
  end loop;

  perform public.write_activity('paper.times_set', 'paper', p_paper::text, null,
    'Set the stage times for "' || v_title || '"', jsonb_build_object('stages', n));
  return n;
end;
$$;

revoke all on function public.paper_stages_set_times(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.paper_stages_set_times(uuid, jsonb) to authenticated;
