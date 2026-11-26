-- =============================================================================
-- Exam countdown: editable stage days, real stage timing, and a heads-up to
-- the next stage's owner when the stage before is late. Safe to run twice.
--
--   app_settings.paper_stage_offsets   { stage: { start, due } } days from the exam day,
--                                      overriding the defaults in lib/papers (new papers only).
--   paper_stage_stats                  Per stage type: done, late, average days late,
--                                      typical real days (started → done).
--   send_stage_late_headsups           09:00 daily: tells the owner of each waiting stage
--                                      that its input stage is past due (once per pair).
-- =============================================================================

alter table public.app_settings
  add column if not exists paper_stage_offsets jsonb not null default '{}'::jsonb;

create or replace function public.paper_stage_offsets()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_page('papers') then
    raise exception 'You are not allowed to see paper settings.' using errcode = '42501';
  end if;
  return (select a.paper_stage_offsets from public.app_settings a where a.id);
end;
$$;

create or replace function public.paper_stage_offsets_set(p_offsets jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  k text;
  v jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change the stage days.' using errcode = '42501';
  end if;
  if p_offsets is null or jsonb_typeof(p_offsets) <> 'object' then
    raise exception 'Check the stage days.' using errcode = 'P0001';
  end if;
  for k, v in select key, value from jsonb_each(p_offsets) loop
    -- Check the shape first, then the numbers (SQL doesn't promise left-to-right OR).
    if k not in ('create_si', 'typeset_si', 'convert', 'typeset_en', 'review_si', 'review_en', 'handover',
                 'scheme', 'scheme_rewrite', 'scheme_en', 'mark')
       or jsonb_typeof(v) is distinct from 'object'
       or jsonb_typeof(v -> 'start') is distinct from 'number' or jsonb_typeof(v -> 'due') is distinct from 'number' then
      raise exception 'Check the stage days.' using errcode = 'P0001';
    end if;
    if (v ->> 'start')::numeric <> trunc((v ->> 'start')::numeric)
       or (v ->> 'due')::numeric <> trunc((v ->> 'due')::numeric)
       or (v ->> 'start')::numeric not between -30 and 30
       or (v ->> 'due')::numeric not between -30 and 30
       or (v ->> 'start')::numeric > (v ->> 'due')::numeric then
      raise exception 'Check the stage days.' using errcode = 'P0001';
    end if;
  end loop;

  update public.app_settings
  set paper_stage_offsets = p_offsets, updated_by = (select auth.uid()), updated_at = now()
  where id;
  perform public.write_activity('settings.paper_offsets', 'settings', 'paper_stage_offsets', null,
    'Changed the usual stage days for new papers', jsonb_build_object('offsets', p_offsets));
end;
$$;

create or replace function public.paper_stage_stats()
returns table (stage text, done integer, late integer, avg_days_late numeric, median_days numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.has_page('papers') then
    raise exception 'You are not allowed to see paper timing.' using errcode = '42501';
  end if;
  return query
  with d as (
    select s.stage,
           ((s.completed_at at time zone 'Asia/Colombo')::date - s.due_date) as days_late,
           extract(epoch from (s.completed_at - coalesce(s.started_at, s.completed_at))) / 86400.0 as real_days
    from public.paper_stages s
    where s.status = 'done' and s.due_date is not null and s.completed_at is not null
  )
  select d.stage,
         count(*)::integer,
         count(*) filter (where d.days_late > 0)::integer,
         round(coalesce(avg(d.days_late) filter (where d.days_late > 0), 0)::numeric, 1),
         round((percentile_cont(0.5) within group (order by d.real_days))::numeric, 1)
  from d
  group by d.stage
  order by d.stage;
end;
$$;

-- Which stage feeds which (lib/papers STAGE_INPUTS, pre-exam part).
create or replace function public.send_stage_late_headsups()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Colombo')::date;
  r record;
  sent integer := 0;
begin
  for r in
    with inputs(next_stage, input_stage) as (
      values ('typeset_si', 'create_si'), ('convert', 'create_si'), ('typeset_en', 'convert'),
             ('review_si', 'typeset_si'), ('review_en', 'typeset_en'),
             ('handover', 'typeset_si'), ('handover', 'typeset_en'),
             ('handover', 'review_si'), ('handover', 'review_en')
    )
    select late.id as late_id, late.stage as late_stage, late.due_date, late.owner_id as late_owner,
           nxt.id as next_id, nxt.owner_id as next_owner, p.id as paper_id, p.title
    from public.paper_stages late
    join public.papers p on p.id = late.paper_id and p.status = 'in_progress'
    join inputs i on i.input_stage = late.stage
    join public.paper_stages nxt on nxt.paper_id = late.paper_id and nxt.stage = i.next_stage
    where late.status = 'in_progress' and late.due_date < today
      and nxt.status = 'waiting' and nxt.owner_id is not null
      and nxt.owner_id is distinct from late.owner_id
  loop
    perform public.notify(r.next_owner, 'stage.before_late',
      r.title || ': ' || public.stage_label(r.late_stage) || ' is late',
      'It was due ' || trim(to_char(r.due_date, 'FMDD Mon')) || '. Your part may start late.',
      '/papers/' || r.paper_id::text,
      'stage-before-late:' || r.late_id::text || ':' || r.next_id::text);
    sent := sent + 1;
  end loop;
  return sent;
end;
$$;

revoke all on function public.paper_stage_offsets() from public, anon, authenticated;
revoke all on function public.paper_stage_offsets_set(jsonb) from public, anon, authenticated;
revoke all on function public.paper_stage_stats() from public, anon, authenticated;
revoke all on function public.send_stage_late_headsups() from public, anon, authenticated;
grant execute on function public.paper_stage_offsets() to authenticated;
grant execute on function public.paper_stage_offsets_set(jsonb) to authenticated;
grant execute on function public.paper_stage_stats() to authenticated;

-- Every day 9:00 Sri Lanka time = 03:30 UTC (scheduling the same name again replaces it)
select cron.schedule('stage-late-headsups', '30 3 * * *', $$ select public.send_stage_late_headsups(); $$);
