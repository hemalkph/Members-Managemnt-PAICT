-- =============================================================================
-- Concession students can be given to members (not only admins), with full or
-- read-only access, like Student results. Safe to run more than once.
-- They still need two-step login (aal2) before the page opens. Members given
-- the page also get the GN certificate reminders.
-- =============================================================================

create or replace function public.has_page(p_page text, p_edit boolean default false)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when coalesce((select auth.jwt() ->> 'aal'), '') <> 'aal2' then false
      when p.is_admin and p.is_main_admin then true
      when p.is_admin then
        case coalesce(p.page_access ->> p_page, 'edit')
          when 'edit' then true
          when 'view' then not p_edit
          else false
        end
      when p_page = any (array['papers', 'tasks', 'classes', 'notices', 'student_results', 'students']) then
        case p.page_access ->> p_page
          when 'edit' then true
          when 'view' then not p_edit
          else false
        end
      else false
    end
    from public.profiles p
    where p.id = (select auth.uid()) and p.is_active
  ), false);
$$;

revoke execute on function public.has_page(text, boolean) from public, anon;
grant execute on function public.has_page(text, boolean) to authenticated;

create or replace function public.send_certificate_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Colombo')::date;
  s record;
  a record;
  valid_until date;
  checked integer := 0;
begin
  for s in
    select st.id, st.student_no, st.full_name, p.certificate_issued_on as issued
    from public.concession_students st
    join public.concession_student_private p on p.student_id = st.id
    where st.status in ('verified', 'under_review')
      and p.certificate_issued_on is not null
      and (p.certificate_issued_on + interval '12 months')::date between today - 7 and today + 30
  loop
    valid_until := (s.issued + interval '12 months')::date;
    -- Everyone who can open Concession students (same rules as has_page).
    for a in
      select id from public.profiles
      where is_active
        and ((is_admin and (is_main_admin or coalesce(page_access ->> 'students', 'edit') in ('edit', 'view')))
          or (not is_admin and page_access ->> 'students' in ('edit', 'view')))
    loop
      if valid_until >= today then
        perform public.notify(a.id, 'student.certificate',
          'GN certificate expires soon: ' || s.full_name,
          'Student ID ' || s.student_no || '. Valid until ' || to_char(valid_until, 'FMDD Mon YYYY')
            || '. Ask the family for a new certificate.',
          '/admin/students/' || s.id::text,
          'cert-soon:' || s.id::text || ':' || s.issued::text);
      else
        perform public.notify(a.id, 'student.certificate_expired',
          'GN certificate expired: ' || s.full_name,
          'Student ID ' || s.student_no || '. It was valid until ' || to_char(valid_until, 'FMDD Mon YYYY')
            || '. Upload the new certificate and change the certificate date.',
          '/admin/students/' || s.id::text,
          'cert-expired:' || s.id::text || ':' || s.issued::text);
      end if;
    end loop;
    checked := checked + 1;
  end loop;
  return checked;
end;
$$;

revoke execute on function public.send_certificate_reminders() from public, anon, authenticated;
