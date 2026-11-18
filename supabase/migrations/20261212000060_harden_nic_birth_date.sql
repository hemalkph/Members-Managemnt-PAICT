-- =============================================================================
-- Keep public.nic_birth_date() aligned with lib/members/nic.ts (parseNic):
-- reject unrealistic years (< 1900 or > 2100) so typos like "0002..." never
-- save out-of-range dates or desynchronise validation. Safe to run twice.
-- =============================================================================

create or replace function public.nic_birth_date(nic text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := upper(trim(coalesce(nic, '')));
  y int;
  d int;
  md date;
begin
  if v ~ '^[0-9]{9}[VX]$' then
    y := 1900 + substr(v, 1, 2)::int;
    d := substr(v, 3, 3)::int;
  elsif v ~ '^[0-9]{12}$' then
    y := substr(v, 1, 4)::int;
    d := substr(v, 5, 3)::int;
  else
    return null;
  end if;

  if y < 1900 or y > 2100 then return null; end if;
  if d > 500 then d := d - 500; end if;
  if d < 1 or d > 366 then return null; end if;

  md := make_date(2000, 1, 1) + (d - 1);           -- 2000 is a leap year
  if extract(month from md) = 2 and extract(day from md) = 29
     and not (y % 4 = 0 and (y % 100 <> 0 or y % 400 = 0)) then
    return null;                                    -- 29 Feb in a non-leap year
  end if;
  return make_date(y, extract(month from md)::int, extract(day from md)::int);
exception when others then
  return null;
end;
$$;

update public.profiles
set date_of_birth = null
where date_of_birth is not null
  and (date_of_birth < date '1900-01-01' or date_of_birth > date '2100-12-31');
