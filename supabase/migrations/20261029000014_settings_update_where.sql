-- =============================================================================
-- Fix: Supabase blocks UPDATE without WHERE for website requests (safeupdate),
-- so saving "Keep paper files N days" and "Save as usual team" failed.
-- Both now update the single settings row explicitly (where id).
-- (No DROP statements, so it runs without confirmation.)
-- =============================================================================

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
  update public.app_settings set paper_file_days = p_days, updated_by = (select auth.uid()), updated_at = now() where id;
  perform public.write_activity('settings.paper_files', 'settings', 'paper_file_days', null,
    'Paper files are now kept ' || p_days || ' days after hand-over', jsonb_build_object('days', p_days));
end;
$$;

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
  update public.app_settings set paper_default_owners = clean, updated_by = (select auth.uid()), updated_at = now() where id;
  perform public.write_activity('settings.paper_team', 'settings', 'paper_default_owners', null,
    'Saved the usual paper team', jsonb_build_object('owners', clean));
end;
$$;
