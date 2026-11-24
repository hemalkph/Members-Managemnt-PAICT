-- =============================================================================
-- "Not counted" tutes. Safe to run more than once.
--
--   * class_tutes.counted_at: when the shelf was last counted (a count of 0
--     saves no stock move, so this is how a 0 count is remembered).
--   * tute_stock_count: sets counted_at on every count.
--   * tute_levels: a tute with no count, no stock move and no print job is
--     'not_counted' instead of 'out' (no alert, not in "Out of stock").
-- =============================================================================

alter table public.class_tutes add column if not exists counted_at timestamptz;

-- Tutes counted before this column existed.
update public.class_tutes ct set counted_at = m.at
from (select tute_id, max(created_at) as at from public.tute_stock_moves
      where kind in ('opening_stock', 'count_fix') group by tute_id) m
where m.tute_id = ct.id and ct.counted_at is null;

-- -----------------------------------------------------------------------------
-- tute_stock_count — remember every count (even 0)
-- -----------------------------------------------------------------------------
create or replace function public.tute_stock_count(p_tute uuid, p_counted integer, p_note text default '')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
  have integer;
  first_count boolean;
  diff integer;
  usual numeric;
  move_id uuid;
begin
  if not public.has_page('tutes', true) then
    raise exception 'You are not allowed to change tute stock.' using errcode = '42501';
  end if;
  if p_counted is null or p_counted < 0 or p_counted > 100000 then
    raise exception 'Count must be between 0 and 100,000.' using errcode = 'P0001';
  end if;
  select id, name into t from public.class_tutes where id = p_tute for update;
  if t.id is null then
    raise exception 'Tute not found.' using errcode = 'P0001';
  end if;
  update public.class_tutes set counted_at = now() where id = p_tute;
  first_count := not exists (select 1 from public.tute_stock_moves where tute_id = p_tute);
  select coalesce(sum(qty), 0) into have from public.tute_stock_moves where tute_id = p_tute;
  diff := p_counted - have;
  if diff = 0 then
    return 0;
  end if;
  -- The usual size of this tute's count fixes (median of the last 10).
  select percentile_cont(0.5) within group (order by abs(x.qty)) into usual
  from (select qty from public.tute_stock_moves
        where tute_id = p_tute and kind = 'count_fix' order by created_at desc limit 10) x;

  insert into public.tute_stock_moves (tute_id, qty, kind, note, created_by)
  values (p_tute, diff, case when first_count then 'opening_stock' else 'count_fix' end,
          left(trim(coalesce(p_note, '')), 300), (select auth.uid()))
  returning id into move_id;
  perform public.write_activity(case when first_count then 'tute.opening_stock' else 'tute.count_fix' end,
    'class_tute', p_tute::text, null,
    case when first_count
      then 'Opening stock for "' || t.name || '": ' || p_counted
      else 'Counted "' || t.name || '": ' || p_counted || ' (' || case when diff > 0 then '+' else '' end || diff || ')'
    end,
    jsonb_build_object('counted', p_counted, 'change', diff));

  -- A big difference compared with this tute's usual ones (or 20% of the record the first time).
  if not first_count and abs(diff) >= 10
     and ((usual is null and abs(diff) > 0.2 * greatest(have, 1))
          or (usual is not null and abs(diff) > 3 * greatest(usual, 1))) then
    perform public.tute_flag_move(move_id, t.name,
      'Count is ' || abs(diff) || case when diff < 0 then ' below' else ' above' end || ' the record'
        || case when usual is not null
             then ', about ' || round(abs(diff) / greatest(usual, 1)) || '× more than usual'
             else '' end
        || '. Check the shelf and the last handouts.');
  end if;

  perform public.send_tute_stock_alerts(p_tute);
  return diff;
end;
$$;

-- -----------------------------------------------------------------------------
-- tute_levels — 'not_counted' before any count, stock or print job
-- -----------------------------------------------------------------------------
create or replace function public.tute_levels(p_month date, p_batch uuid default null)
returns table (
  tute_id uuid, batch_id uuid, name text, is_active boolean, reorder_level integer,
  on_hand integer, in_print integer, open_jobs integer,
  need_this integer, given_this integer, need_next integer, need_after integer,
  safety integer, loss_extra integer,
  scheduled_this boolean, scheduled_next boolean, status text
)
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select
      ct.id, ct.batch_id, ct.name, ct.is_active, ct.reorder_level,
      coalesce((select sum(mv.qty) from public.tute_stock_moves mv where mv.tute_id = ct.id), 0)::integer as on_hand,
      coalesce((select sum(greatest(j.qty - j.received_qty, 0)) from public.tute_print_jobs j
                where j.tute_id = ct.id and j.status in ('planned', 'printing')), 0)::integer as in_print,
      (select count(*) from public.tute_print_jobs j
        where j.tute_id = ct.id and j.status in ('planned', 'printing'))::integer as open_jobs,
      coalesce((select sum(public.tute_expected_students(s.class_id, s.month)) from public.class_month_tutes s
                where s.tute_id = ct.id and s.month = p_month), 0)::integer as need_this,
      coalesce((select sum(-mv.qty) from public.tute_stock_moves mv
                where mv.tute_id = ct.id and mv.month = p_month and mv.kind in ('class_issue', 'post_out')), 0)::integer as given_this,
      coalesce((select sum(public.tute_expected_students(s.class_id, s.month)) from public.class_month_tutes s
                where s.tute_id = ct.id and s.month = (p_month + interval '1 month')::date), 0)::integer as need_next,
      coalesce((select sum(public.tute_expected_students(s.class_id, s.month)) from public.class_month_tutes s
                where s.tute_id = ct.id and s.month = (p_month + interval '2 months')::date), 0)::integer as need_after,
      -- Forecast error of the months that are still guesses (no paid list yet).
      coalesce((select sqrt(sum(f.error * f.error)) from public.class_month_tutes s
                cross join lateral public.tute_class_forecast(s.class_id, s.month) f
                where s.tute_id = ct.id
                  and s.month in (p_month, (p_month + interval '1 month')::date)
                  and not exists (select 1 from public.fee_month_imports i
                                  where i.class_id = s.class_id and i.month = s.month)), 0) as forecast_error,
      -- Copies lost (damaged, counted short) per copy given out, last 6 months.
      coalesce((select sum(-mv.qty) filter (where mv.kind = 'damaged' or (mv.kind = 'count_fix' and mv.qty < 0))::numeric
                       / nullif(sum(-mv.qty) filter (where mv.kind in ('class_issue', 'post_out')), 0)
                from public.tute_stock_moves mv
                where mv.tute_id = ct.id and mv.created_at > now() - interval '6 months'), 0) as loss_rate,
      (ct.counted_at is not null
        or exists (select 1 from public.tute_stock_moves mv where mv.tute_id = ct.id)
        or exists (select 1 from public.tute_print_jobs j where j.tute_id = ct.id)) as has_record,
      exists (select 1 from public.class_month_tutes s where s.tute_id = ct.id and s.month = p_month) as scheduled_this,
      exists (select 1 from public.class_month_tutes s
              where s.tute_id = ct.id and s.month = (p_month + interval '1 month')::date) as scheduled_next
    from public.class_tutes ct
    where p_batch is null or ct.batch_id = p_batch
  ),
  demand as (
    select b.*, greatest(b.need_this - b.given_this, 0) + b.need_next as still_needed from base b
  ),
  extra as (
    select
      d.*,
      case when d.still_needed = 0 then 0
           else greatest(ceil(1.65 * d.forecast_error), ceil(0.05 * d.still_needed), 5)::integer end as safety,
      ceil(d.loss_rate * d.still_needed)::integer as loss_extra
    from demand d
  )
  select
    x.id, x.batch_id, x.name, x.is_active, x.reorder_level, x.on_hand, x.in_print, x.open_jobs,
    x.need_this, x.given_this, x.need_next, x.need_after, x.safety, x.loss_extra,
    x.scheduled_this, x.scheduled_next,
    case when not x.has_record then 'not_counted'
         else public.tute_status(x.on_hand, x.in_print, greatest(x.need_this - x.given_this, 0),
                                 x.need_next + x.safety + x.loss_extra,
                                 x.reorder_level, x.scheduled_this, x.scheduled_next) end
  from extra x;
$$;

revoke all on function public.tute_levels(date, uuid) from public, anon, authenticated;
revoke all on function public.tute_stock_count(uuid, integer, text) from public, anon;
grant execute on function public.tute_stock_count(uuid, integer, text) to authenticated;
