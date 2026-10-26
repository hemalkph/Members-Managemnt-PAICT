-- =============================================================================
-- Storage buckets (both PRIVATE — files are served with short-lived signed URLs)
-- Object paths always start with the owner's user id: "<user_id>/<file>".
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('attachments', 'attachments', false, 10485760, null),  -- 10 MB per file
  ('avatars', 'avatars', false, 5242880,                   -- 5 MB per photo
   array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- attachments ---------------------------------------------------------------
create policy "attachments bucket: owner or admin reads"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_admin())
  );

create policy "attachments bucket: owner uploads to own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.is_active_member()
  );

create policy "attachments bucket: owner or admin deletes"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_admin())
  );

-- avatars -------------------------------------------------------------------
create policy "avatars bucket: owner or admin reads"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_admin())
  );

create policy "avatars bucket: owner uploads"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "avatars bucket: owner updates"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars bucket: owner or admin deletes"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_admin())
  );
