drop policy if exists cms_media_admin_insert on storage.objects;
drop policy if exists cms_media_admin_update on storage.objects;
drop policy if exists cms_media_admin_delete on storage.objects;
drop function if exists public.is_cms_media_admin();
