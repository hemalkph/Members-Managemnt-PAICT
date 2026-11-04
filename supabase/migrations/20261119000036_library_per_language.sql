-- Paper library, per language. Safe to run twice.
-- The Sinhala paper shows once the Sinhala review is done, the English paper
-- once the English review is done – one side no longer waits for the other.
-- (A skipped review counts once its type setting is done.) The hand-over PDF
-- still waits for every step up to the reviews; marking schemes are unchanged.

create or replace function public.library_file_ok(p_paper uuid, p_stage text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.papers p where p.id = p_paper and p.status <> 'cancelled')
     and case
       when p_stage in ('typeset_si', 'typeset_en') then
         exists (
           select 1
           from public.paper_stages r
           join public.paper_stages t on t.paper_id = r.paper_id
             and t.stage = p_stage
           where r.paper_id = p_paper
             and r.stage = case p_stage when 'typeset_si' then 'review_si' else 'review_en' end
             and (r.status = 'done' or (r.status = 'skipped' and t.status = 'done'))
         )
       when p_stage = 'handover' then
         not exists (select 1 from public.paper_stages s
                     where s.paper_id = p_paper and s.position <= 6 and s.status in ('waiting', 'in_progress'))
         and exists (select 1 from public.paper_stages s
                     where s.paper_id = p_paper and s.position <= 6 and s.status = 'done')
       when p_stage in ('scheme', 'scheme_rewrite', 'scheme_en') then
         not exists (select 1 from public.paper_stages s
                     where s.paper_id = p_paper and s.stage in ('scheme', 'scheme_rewrite', 'scheme_en')
                       and s.status in ('waiting', 'in_progress'))
         and exists (select 1 from public.paper_stages s
                     where s.paper_id = p_paper and s.stage in ('scheme', 'scheme_rewrite', 'scheme_en')
                       and s.status = 'done')
       else false
     end;
$$;

revoke all on function public.library_file_ok(uuid, text) from public, anon;
grant execute on function public.library_file_ok(uuid, text) to authenticated;
