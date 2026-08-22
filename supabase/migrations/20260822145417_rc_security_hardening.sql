alter function public.set_cms_updated_metadata() set search_path = '';
alter function public.set_updated_at() set search_path = '';
alter function public.set_runtime_settings_updated_at() set search_path = '';

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
