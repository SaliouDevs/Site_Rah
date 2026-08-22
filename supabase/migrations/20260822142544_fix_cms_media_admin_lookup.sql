create or replace function public.is_cms_media_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = auth.uid()
      and coalesce(u.raw_app_meta_data ->> 'role','') = 'admin'
  );
$$;

revoke all on function public.is_cms_media_admin() from public, anon;
grant execute on function public.is_cms_media_admin() to authenticated;

drop policy if exists cms_media_admin_insert on storage.objects;
drop policy if exists cms_media_admin_update on storage.objects;
drop policy if exists cms_media_admin_delete on storage.objects;

create policy cms_media_admin_insert
on storage.objects
for insert
to authenticated
with check (bucket_id = 'cms-media' and public.is_cms_media_admin());

create policy cms_media_admin_update
on storage.objects
for update
to authenticated
using (bucket_id = 'cms-media' and public.is_cms_media_admin())
with check (bucket_id = 'cms-media' and public.is_cms_media_admin());

create policy cms_media_admin_delete
on storage.objects
for delete
to authenticated
using (bucket_id = 'cms-media' and public.is_cms_media_admin());
