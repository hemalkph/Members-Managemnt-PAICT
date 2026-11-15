-- =============================================================================
-- The stage owner (or a Papers editor) can rename a shared file, change what
-- it is (its tag) and its remark, so the next stages know what each file is.
-- Safe to run more than once. Needs 20261208000056_stage_files.sql.
-- =============================================================================

create or replace function public.update_paper_file(p_file uuid, p_name text, p_tag text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f record;
begin
  select paper_id, stage into f from public.paper_files where id = p_file;
  if not found then
    raise exception 'File not found.';
  end if;
  if not public.can_manage_stage_files(f.paper_id, f.stage) then
    raise exception 'Only the stage owner can edit this file.' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 200 then
    raise exception 'Give the file a name (up to 200 letters).';
  end if;
  update public.paper_files
     set file_name = trim(p_name),
         tag = p_tag,
         note = nullif(trim(coalesce(p_note, '')), '')
   where id = p_file;
end;
$$;

revoke all on function public.update_paper_file(uuid, text, text, text) from public, anon;
grant execute on function public.update_paper_file(uuid, text, text, text) to authenticated;
