-- =============================================================================
-- Money page (main admins only): one monthly fee per class, income per
-- class and month, and the printing and postage costs.
-- Safe to run more than once.
--
--   class_fees        The monthly fee of a class "from a month" onwards. A later
--                     row changes the fee from its month; earlier months keep theirs.
--   class_fee_for     Internal: the fee in force for a class in a month (or null).
--   class_fee_set     Set or change a fee from a month.
--   class_fee_list    Every class with the fee in force this month.
--   money_income      Income per class and month: the sum of amounts when the
--                     paid list has them, else (paid − Free enrollment) × fee.
--   money_costs       Printing (print job costs) and postage (Speed Post receipts) per month.
--
-- Staff pay comes from the app (the same sum the Analytics page shows).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Class fees
-- -----------------------------------------------------------------------------
create table if not exists public.class_fees (
  class_id    uuid not null references public.fee_classes (id) on delete cascade,
  from_month  date not null check (extract(day from from_month) = 1),
  monthly_fee numeric(10, 2) not null check (monthly_fee between 0 and 10000000),
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (class_id, from_month)
);

alter table public.class_fees enable row level security;
revoke all on table public.class_fees from public, anon, authenticated;

create or replace function public.class_fee_for(p_class uuid, p_month date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select cf.monthly_fee
  from public.class_fees cf
  where cf.class_id = p_class and cf.from_month <= date_trunc('month', p_month)::date
  order by cf.from_month desc
  limit 1;
$$;

create or replace function public.class_fee_set(p_class uuid, p_from_month date, p_fee numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m date := date_trunc('month', p_from_month)::date;
  cls_name text;
begin
  if not public.is_main_admin() then
    raise exception 'Only main admins can set class fees.' using errcode = '42501';
  end if;
  select c.name into cls_name from public.fee_classes c where c.id = p_class;
  if cls_name is null then
    raise exception 'Class not found.' using errcode = 'P0001';
  end if;
  if m is null then
    raise exception 'Choose a month.' using errcode = 'P0001';
  end if;
  if p_fee is null or p_fee < 0 or p_fee > 10000000 then
    raise exception 'Fee must be between 0 and 10,000,000.' using errcode = 'P0001';
  end if;

  insert into public.class_fees (class_id, from_month, monthly_fee, updated_by, updated_at)
  values (p_class, m, round(p_fee, 2), (select auth.uid()), now())
  on conflict (class_id, from_month) do update
    set monthly_fee = excluded.monthly_fee, updated_by = excluded.updated_by, updated_at = now();

  perform public.write_activity('class.fee_set', 'fee_class', p_class::text, null,
    'Set the fee for ' || cls_name || ' to Rs ' || to_char(round(p_fee, 2), 'FM999,999,990.00')
      || ' from ' || public.month_name(m),
    jsonb_build_object('class_id', p_class, 'from_month', m, 'fee', round(p_fee, 2)));
end;
$$;

create or replace function public.class_fee_list()
returns table (class_id uuid, class_name text, batch_name text, is_active boolean, fee numeric, from_month date)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  this_month date := date_trunc('month', now() at time zone 'Asia/Colombo')::date;
begin
  if not public.is_main_admin() then
    raise exception 'Only main admins can see class fees.' using errcode = '42501';
  end if;
  return query
  select c.id, c.name, b.name, c.is_active, cf.monthly_fee, cf.from_month
  from public.fee_classes c
  join public.batches b on b.id = c.batch_id
  left join lateral (
    select x.monthly_fee, x.from_month
    from public.class_fees x
    where x.class_id = c.id and x.from_month <= this_month
    order by x.from_month desc
    limit 1
  ) cf on true
  order by b.sort_order, b.name, c.name;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Income and costs
-- -----------------------------------------------------------------------------
create or replace function public.money_income(p_from date, p_to date)
returns table (
  class_id uuid, class_name text, batch_name text, month date, fee numeric,
  paid integer, free integer, amount_total numeric, income numeric, income_source text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  f date := date_trunc('month', p_from)::date;
  t date := date_trunc('month', p_to)::date;
begin
  if not public.is_main_admin() then
    raise exception 'Only main admins can see money.' using errcode = '42501';
  end if;
  if f is null or t is null or t < f or t > (f + interval '23 months')::date then
    raise exception 'Choose at most 24 months.' using errcode = 'P0001';
  end if;

  return query
  with months as (
    select gs::date as m from generate_series(f, t, interval '1 month') gs
  ),
  classes as (
    select c.id, c.name, b.name as bname, b.sort_order
    from public.fee_classes c
    join public.batches b on b.id = c.batch_id
    where c.is_active
       or exists (select 1 from public.fee_month_imports i where i.class_id = c.id and i.month between f and t)
       or exists (select 1 from public.fee_month_upload_log l where l.class_id = c.id and l.month between f and t)
  ),
  cells as (
    select cl.id, cl.name, cl.bname, cl.sort_order, mo.m,
           public.class_fee_for(cl.id, mo.m) as fee,
           public.class_paid_count(cl.id, mo.m) as paid,
           coalesce(s.free, 0) as free,
           coalesce(s.n_amounts, 0) as n_amounts,
           s.amount_total
    from classes cl
    cross join months mo
    left join lateral (
      select count(*) filter (where st.export_label = 'Free enrollment')::integer as free,
             count(st.amount)::integer as n_amounts,
             sum(st.amount) as amount_total
      from public.fee_month_students st
      where st.class_id = cl.id and st.month = mo.m
    ) s on true
  )
  select x.id, x.name, x.bname, x.m, x.fee, x.paid, x.free, x.amount_total,
         case
           when x.n_amounts > 0 then x.amount_total
           when x.paid is null or x.fee is null then null
           else greatest(x.paid - x.free, 0) * x.fee
         end,
         case
           when x.n_amounts > 0 then 'amounts'
           when x.paid is null then 'no_count'
           when x.fee is null then 'no_fee'
           else 'fee'
         end
  from cells x
  order by x.sort_order, x.bname, x.name, x.m;
end;
$$;

create or replace function public.money_costs(p_from date, p_to date)
returns table (month date, printing numeric, postage numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  f date := date_trunc('month', p_from)::date;
  t date := date_trunc('month', p_to)::date;
begin
  if not public.is_main_admin() then
    raise exception 'Only main admins can see money.' using errcode = '42501';
  end if;
  if f is null or t is null or t < f or t > (f + interval '23 months')::date then
    raise exception 'Choose at most 24 months.' using errcode = 'P0001';
  end if;

  return query
  select mo.m,
         coalesce((
           select sum(j.cost)
           from public.tute_print_jobs j
           where j.status <> 'cancelled' and j.cost is not null
             and date_trunc('month', coalesce(j.received_at, j.created_at) at time zone 'Asia/Colombo')::date = mo.m
         ), 0),
         coalesce((
           select sum(r.receipt_total)
           from public.post_rounds r
           where r.status <> 'cancelled' and r.month = mo.m
         ), 0)
  from (select gs::date as m from generate_series(f, t, interval '1 month') gs) mo
  order by mo.m;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Grants: everything through the functions; class_fee_for stays internal.
-- -----------------------------------------------------------------------------
revoke all on function public.class_fee_for(uuid, date) from public, anon, authenticated;
revoke all on function public.class_fee_set(uuid, date, numeric) from public, anon, authenticated;
revoke all on function public.class_fee_list() from public, anon, authenticated;
revoke all on function public.money_income(date, date) from public, anon, authenticated;
revoke all on function public.money_costs(date, date) from public, anon, authenticated;
grant execute on function public.class_fee_set(uuid, date, numeric) to authenticated;
grant execute on function public.class_fee_list() to authenticated;
grant execute on function public.money_income(date, date) to authenticated;
grant execute on function public.money_costs(date, date) to authenticated;
