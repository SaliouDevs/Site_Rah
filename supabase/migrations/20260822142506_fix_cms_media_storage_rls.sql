drop policy if exists cms_media_admin_insert on storage.objects;
drop policy if exists cms_media_admin_update on storage.objects;
drop policy if exists cms_media_admin_delete on storage.objects;

create policy cms_media_admin_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'cms-media'
  and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
);

create policy cms_media_admin_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'cms-media'
  and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
)
with check (
  bucket_id = 'cms-media'
  and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
);

create policy cms_media_admin_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'cms-media'
  and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
);
