-- =============================================================================
-- Members & admin tools
--   1. Default paper team: the usual owner of each stage, filled in on new papers.
--   2. Overdue escalation: when a task or paper stage is a day late, admins get
--      one alert per task (with the member's WhatsApp on the paper page).
--   3. "Starts tomorrow" reminders at 6 pm for paper stages.
-- (No DROP statements, so it runs without confirmation.)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Default paper team: { "create_si": "<profile id>", "typeset_si": "...", ... }
-- -----------------------------------------------------------------------------
alter table public.app_settings add column if not exists paper_default_owners jsonb not null default '{}'::jsonb;

create or replace function public.set_paper_default_owners(p_owners jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  k text;
  v text;
  clean jsonb := '{}'::jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only admins can set the paper team.' using errcode = '42501';
  end if;
  if p_owners is null or jsonb_typeof(p_owners) <> 'object' then
    raise exception 'Invalid team.' using errcode = 'P0001';
  end if;
  for k, v in select key, value from jsonb_each_text(p_owners) loop
    if k not in ('create_si', 'typeset_si', 'convert', 'typeset_en', 'review_si', 'review_en', 'handover', 'mark') then
      raise exception 'Unknown stage: %', k using errcode = 'P0001';
    end if;
    continue when v is null or v = '';
    if not exists (select 1 from public.profiles where id = v::uuid and is_active) then
      raise exception 'Choose active members only.' using errcode = 'P0001';
    end if;
    clean := clean || jsonb_build_object(k, v);
  end loop;
  update public.app_settings set paper_default_owners = clean, updated_by = (select auth.uid()), updated_at = now();
  perform public.write_activity('settings.paper_team', 'settings', 'paper_default_owners', null,
    'Saved the usual paper team', jsonb_build_object('owners', clean));
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Task reminders (as before) + overdue escalation to admins
-- -----------------------------------------------------------------------------
create or replace function public.send_task_reminders()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Colombo')::date;
  t public.tasks;
  admin_row record;
  member_name text;
begin
  for t in
    select * from public.tasks
    where status = 'open' and due_date is not null and due_date <= today + 1
  loop
    if t.due_date < today then
      perform public.notify(t.assignee_id, 'task.overdue', 'Overdue: ' || t.title,
        'It was due ' || trim(to_char(t.due_date, 'FMDD Mon')) || '. Finish it or tell an admin.',
        public.task_link(t), 'task-overdue:' || t.id::text);

      -- Escalate once to the admins (not to the late person themselves).
      member_name := coalesce(public.profile_name(t.assignee_id), 'A member');
      for admin_row in
        select id from public.profiles where is_admin and is_active and id <> t.assignee_id
      loop
        perform public.notify(admin_row.id, 'task.escalated',
          'Late: ' || t.title,
          member_name || ' · was due ' || trim(to_char(t.due_date, 'FMDD Mon'))
            || '. Open it to message them on WhatsApp.',
          case when t.paper_stage_id is not null then public.task_link(t) else '/admin/tasks' end,
          'task-escalated:' || t.id::text);
      end loop;
    else
      perform public.notify(t.assignee_id, 'task.due',
        'Due ' || case when t.due_date = today then 'today' else 'tomorrow' end || ': ' || t.title,
        null, public.task_link(t), 'task-due:' || t.id::text || ':' || t.due_date::text);
    end if;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. 6 pm: "Starts tomorrow" for paper stages
-- -----------------------------------------------------------------------------
create or replace function public.send_stage_start_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  tomorrow date := (now() at time zone 'Asia/Colombo')::date + 1;
  s record;
  sent integer := 0;
begin
  for s in
    select ps.id, ps.stage, ps.owner_id, ps.start_date, ps.due_date, p.id as paper_id, p.title
    from public.paper_stages ps
    join public.papers p on p.id = ps.paper_id
    where p.status = 'in_progress'
      and ps.status in ('waiting', 'in_progress')
      and ps.owner_id is not null
      and ps.start_date = tomorrow
  loop
    perform public.notify(s.owner_id, 'stage.tomorrow',
      'Starts tomorrow: ' || public.stage_label(s.stage) || ' – ' || s.title,
      case
        when s.due_date is not null and s.due_date <> s.start_date then
          'Work days: ' || trim(to_char(s.start_date, 'Dy FMDD Mon')) || ' – ' || trim(to_char(s.due_date, 'Dy FMDD Mon')) || '.'
        else 'Work day: ' || trim(to_char(s.start_date, 'Dy FMDD Mon')) || '.'
      end,
      '/papers/' || s.paper_id::text,
      'stage-start:' || s.id::text);
    sent := sent + 1;
  end loop;
  return sent;
end;
$$;

-- 18:00 Sri Lanka time = 12:30 UTC
select cron.schedule('stage-start-reminders', '30 12 * * *', $$ select public.send_stage_start_reminders(); $$);

-- -----------------------------------------------------------------------------
-- Permissions
-- -----------------------------------------------------------------------------
revoke execute on function public.send_task_reminders() from public, anon, authenticated;
revoke execute on function public.send_stage_start_reminders() from public, anon, authenticated;
revoke execute on function public.set_paper_default_owners(jsonb) from public, anon;
grant execute on function public.set_paper_default_owners(jsonb) to authenticated;
