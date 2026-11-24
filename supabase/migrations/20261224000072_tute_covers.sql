-- =============================================================================
-- Tute cover images (private bucket "tute-covers"). Safe to run more than once.
--
--   * class_tutes.cover_path: storage path "<tute_id>/cover-<ts>.<ext>" in
--     the private "tute-covers" bucket (JPEG/PNG/WebP up to 5 MB).
--   * tute_set_cover: sets or clears cover_path (Tute stock editors only) and
--     returns the previous path so the app can remove the replaced file.
-- =============================================================================

alter table public.class_tutes add column if not exists cover_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tute-covers', 'tute-covers', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "tute-covers: page read" on storage.objects;
create policy "tute-covers: page read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'tute-covers'
    and (
      (select public.has_page('tutes'))
      or (select public.has_page('fee_reminders'))
      or (select public.has_page('post'))
    )
  );

drop policy if exists "tute-covers: editors add" on storage.objects;
create policy "tute-covers: editors add"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'tute-covers'
    and (select public.has_page('tutes', true))
    and exists (select 1 from public.class_tutes t where t.id::text = (storage.foldername(name))[1])
  );

drop policy if exists "tute-covers: editors remove" on storage.objects;
create policy "tute-covers: editors remove"
  on storage.objects for delete to authenticated
  using (bucket_id = 'tute-covers' and (select public.has_page('tutes', true)));

create or replace function public.tute_set_cover(p_id uuid, p_path text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean text := nullif(trim(coalesce(p_path, '')), '');
  t record;
begin
  if not public.has_page('tutes', true) then
    raise exception 'You are not allowed to change tute covers.' using errcode = '42501';
  end if;

  select id, name, cover_path into t from public.class_tutes where id = p_id for update;
  if t.id is null then
    raise exception 'Tute not found.' using errcode = 'P0001';
  end if;

  if clean is not null then
    if char_length(clean) > 300 or position('..' in clean) > 0 or left(clean, 37) <> (p_id::text || '/') then
      raise exception 'Invalid cover image path.' using errcode = 'P0001';
    end if;
  end if;

  update public.class_tutes set cover_path = clean where id = p_id;

  perform public.write_activity('tute.cover_changed', 'class_tute', p_id::text, null,
    case when clean is null then 'Removed cover image for "' || t.name || '"'
         else 'Updated cover image for "' || t.name || '"' end,
    jsonb_build_object('has_cover', clean is not null));

  return t.cover_path;
end;
$$;

revoke all on function public.tute_set_cover(uuid, text) from public, anon, authenticated;
grant execute on function public.tute_set_cover(uuid, text) to authenticated;
