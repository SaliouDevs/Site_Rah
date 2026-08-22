alter table public.cms_media_assets
  drop constraint if exists cms_media_assets_media_kind_check;
alter table public.cms_media_assets
  add constraint cms_media_assets_media_kind_check
  check (media_kind in ('image','audio','video','other'));

alter table public.cms_media_assets
  drop constraint if exists cms_media_assets_language_check;
alter table public.cms_media_assets
  add constraint cms_media_assets_language_check
  check (language is null or language in ('fr','wo','sn'));

update storage.buckets
set file_size_limit = 52428800,
    allowed_mime_types = array[
      'image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif',
      'audio/mpeg','audio/mp4','audio/x-m4a','audio/wav','audio/x-wav','audio/ogg','audio/webm','audio/aac',
      'video/mp4','video/quicktime','video/webm','video/x-m4v','video/mpeg'
    ]::text[]
where id = 'cms-media';
