-- =============================================================================
-- Concession students: GN certificate expiry reminders. Safe to run more than once.
--
-- A GN certificate is good for 12 months from its date. Every day at 9:00
-- (Sri Lanka) admins who can open Concession students get a notification:
--   * once, when a Verified or Under review student's certificate has 30 days
--     or less left;
--   * once, when it has run out (sent for up to 7 days after, so a missed run
--     catches up but old certificates don't flood the inbox on the first run).
-- A new certificate date starts the reminders again.
-- =============================================================================

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
    for a in
      select id from public.profiles
      where is_active and is_admin
        and (is_main_admin or coalesce(page_access ->> 'students', 'edit') in ('edit', 'view'))
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

-- 9:00 Sri Lanka time = 03:30 UTC (scheduling the same name again replaces it)
select cron.schedule('certificate-reminders', '30 3 * * *', $$ select public.send_certificate_reminders(); $$);
