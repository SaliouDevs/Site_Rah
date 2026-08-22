-- V3.3.1 content CMS workflows for lessons, panels and media.

create unique index if not exists uq_cms_lesson_active_draft
  on public.cms_lesson_versions(lesson_id) where status = 'draft';
create unique index if not exists uq_cms_panel_active_draft
  on public.cms_panel_versions(panel_id) where status = 'draft';

create or replace function public.admin_seed_lesson(
  p_legacy_id text,
  p_title text,
  p_description text,
  p_html text,
  p_sort_order integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lesson_id uuid;
  v_version_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
  if nullif(btrim(p_legacy_id),'') is null or nullif(btrim(p_title),'') is null or nullif(btrim(p_html),'') is null then
    raise exception 'Invalid lesson seed' using errcode='22023';
  end if;

  select id into v_lesson_id from public.cms_lessons where legacy_id = p_legacy_id;
  if found then return v_lesson_id; end if;

  v_lesson_id := gen_random_uuid();
  v_version_id := gen_random_uuid();
  insert into public.cms_lessons(id, legacy_id) values(v_lesson_id, p_legacy_id);
  insert into public.cms_lesson_versions(id, lesson_id, status, version_number, title, description, sort_order)
  values(v_version_id, v_lesson_id, 'published', 1, p_title, nullif(p_description,''), p_sort_order);
  insert into public.cms_lesson_steps(lesson_version_id, title, content, sort_order)
  values(v_version_id, null, p_html, 1);
  update public.cms_lessons set current_version_id = v_version_id where id = v_lesson_id;
  return v_lesson_id;
end;
$$;

create or replace function public.create_cms_lesson_draft(p_lesson_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current uuid;
  v_existing uuid;
  v_new uuid;
  v_next integer;
  v_src public.cms_lesson_versions%rowtype;
begin
  if not public.is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
  select id into v_existing from public.cms_lesson_versions where lesson_id=p_lesson_id and status='draft' limit 1;
  if found then return v_existing; end if;
  select current_version_id into v_current from public.cms_lessons where id=p_lesson_id for update;
  if not found or v_current is null then raise exception 'Published lesson not found' using errcode='22023'; end if;
  select * into v_src from public.cms_lesson_versions where id=v_current and lesson_id=p_lesson_id;
  select coalesce(max(version_number),0)+1 into v_next from public.cms_lesson_versions where lesson_id=p_lesson_id;
  v_new := gen_random_uuid();
  insert into public.cms_lesson_versions(id,lesson_id,status,version_number,title,description,sort_order)
  values(v_new,p_lesson_id,'draft',v_next,v_src.title,v_src.description,v_src.sort_order);
  insert into public.cms_lesson_steps(lesson_version_id,title,content,sort_order)
    select v_new,title,content,sort_order from public.cms_lesson_steps where lesson_version_id=v_current order by sort_order;
  return v_new;
end;
$$;

create or replace function public.save_cms_lesson_draft(
  p_lesson_id uuid,
  p_version_id uuid,
  p_title text,
  p_description text,
  p_steps jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
  if nullif(btrim(p_title),'') is null or p_steps is null or jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps)=0 then
    raise exception 'Title and lesson content are required' using errcode='22023';
  end if;
  if not exists(select 1 from public.cms_lesson_versions where id=p_version_id and lesson_id=p_lesson_id and status='draft') then
    raise exception 'Draft not found' using errcode='22023';
  end if;
  update public.cms_lesson_versions set title=p_title, description=nullif(p_description,'') where id=p_version_id;
  delete from public.cms_lesson_steps where lesson_version_id=p_version_id;
  insert into public.cms_lesson_steps(lesson_version_id,title,content,sort_order)
  select p_version_id, nullif(item->>'title',''), item->>'content', coalesce((item->>'sort_order')::integer, ord::integer)
  from jsonb_array_elements(p_steps) with ordinality as x(item,ord)
  where nullif(btrim(item->>'content'),'') is not null;
  if not exists(select 1 from public.cms_lesson_steps where lesson_version_id=p_version_id) then
    raise exception 'Lesson content cannot be empty' using errcode='22023';
  end if;
  return true;
end;
$$;

create or replace function public.publish_cms_lesson_version(p_lesson_id uuid,p_version_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_old uuid;
begin
  if not public.is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
  select current_version_id into v_old from public.cms_lessons where id=p_lesson_id for update;
  if not found then raise exception 'Lesson not found' using errcode='22023'; end if;
  if not exists(select 1 from public.cms_lesson_versions where id=p_version_id and lesson_id=p_lesson_id and status='draft') then
    raise exception 'Draft not found' using errcode='22023'; end if;
  if not exists(select 1 from public.cms_lesson_steps where lesson_version_id=p_version_id and nullif(btrim(content),'') is not null) then
    raise exception 'Draft content missing' using errcode='22023'; end if;
  if v_old is not null then update public.cms_lesson_versions set status='archived' where id=v_old; end if;
  update public.cms_lesson_versions set status='published' where id=p_version_id;
  update public.cms_lessons set current_version_id=p_version_id where id=p_lesson_id;
  return true;
end;
$$;

create or replace function public.restore_cms_lesson_version_as_draft(p_lesson_id uuid,p_source_version_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_new uuid; v_next integer; v_src public.cms_lesson_versions%rowtype;
begin
  if not public.is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
  if exists(select 1 from public.cms_lesson_versions where lesson_id=p_lesson_id and status='draft') then
    raise exception 'A draft already exists' using errcode='23505'; end if;
  select * into v_src from public.cms_lesson_versions where id=p_source_version_id and lesson_id=p_lesson_id;
  if not found then raise exception 'Source version not found' using errcode='22023'; end if;
  select coalesce(max(version_number),0)+1 into v_next from public.cms_lesson_versions where lesson_id=p_lesson_id;
  v_new:=gen_random_uuid();
  insert into public.cms_lesson_versions(id,lesson_id,status,version_number,title,description,sort_order)
  values(v_new,p_lesson_id,'draft',v_next,v_src.title,v_src.description,v_src.sort_order);
  insert into public.cms_lesson_steps(lesson_version_id,title,content,sort_order)
    select v_new,title,content,sort_order from public.cms_lesson_steps where lesson_version_id=p_source_version_id order by sort_order;
  return v_new;
end;
$$;

create or replace function public.delete_cms_lesson_version(p_lesson_id uuid,p_version_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_current uuid; v_ver public.cms_lesson_versions%rowtype; v_snapshot jsonb;
begin
  if not public.is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
  select current_version_id into v_current from public.cms_lessons where id=p_lesson_id for update;
  if not found then raise exception 'Lesson not found' using errcode='22023'; end if;
  if v_current=p_version_id then raise exception 'Active version cannot be deleted' using errcode='42501'; end if;
  select * into v_ver from public.cms_lesson_versions where id=p_version_id and lesson_id=p_lesson_id;
  if not found then return false; end if;
  select jsonb_build_object('version',to_jsonb(v_ver),'steps',coalesce((select jsonb_agg(to_jsonb(s) order by s.sort_order) from public.cms_lesson_steps s where s.lesson_version_id=p_version_id),'[]'::jsonb)) into v_snapshot;
  insert into public.cms_content_versions(entity_type,entity_id,version_number,snapshot,created_by)
  values('cms_lesson_version_deleted',p_lesson_id,v_ver.version_number,v_snapshot,auth.uid()) on conflict do nothing;
  delete from public.cms_lesson_versions where id=p_version_id;
  return found;
end;
$$;

create or replace function public.admin_seed_panel(
  p_legacy_id text,p_category text,p_title text,p_description text,p_image_path text,p_sort_order integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_panel_id uuid; v_version_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
  if nullif(btrim(p_legacy_id),'') is null or nullif(btrim(p_category),'') is null or nullif(btrim(p_title),'') is null then raise exception 'Invalid panel seed' using errcode='22023'; end if;
  select id into v_panel_id from public.cms_panels where legacy_id=p_legacy_id;
  if found then return v_panel_id; end if;
  v_panel_id:=gen_random_uuid(); v_version_id:=gen_random_uuid();
  insert into public.cms_panels(id,legacy_id,category) values(v_panel_id,p_legacy_id,p_category);
  insert into public.cms_panel_versions(id,panel_id,status,version_number,title,description,image_path,sort_order)
  values(v_version_id,v_panel_id,'published',1,p_title,nullif(p_description,''),nullif(p_image_path,''),p_sort_order);
  update public.cms_panels set current_version_id=v_version_id where id=v_panel_id;
  return v_panel_id;
end;
$$;

create or replace function public.create_cms_panel_draft(p_panel_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_existing uuid; v_current uuid; v_new uuid; v_next integer; v_src public.cms_panel_versions%rowtype;
begin
  if not public.is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
  select id into v_existing from public.cms_panel_versions where panel_id=p_panel_id and status='draft' limit 1;
  if found then return v_existing; end if;
  select current_version_id into v_current from public.cms_panels where id=p_panel_id for update;
  if not found or v_current is null then raise exception 'Published panel not found' using errcode='22023'; end if;
  select * into v_src from public.cms_panel_versions where id=v_current and panel_id=p_panel_id;
  select coalesce(max(version_number),0)+1 into v_next from public.cms_panel_versions where panel_id=p_panel_id;
  v_new:=gen_random_uuid();
  insert into public.cms_panel_versions(id,panel_id,status,version_number,title,description,image_path,audio_fr_path,audio_wo_path,sort_order)
  values(v_new,p_panel_id,'draft',v_next,v_src.title,v_src.description,v_src.image_path,v_src.audio_fr_path,v_src.audio_wo_path,v_src.sort_order);
  return v_new;
end;
$$;

create or replace function public.save_cms_panel_draft(
  p_panel_id uuid,p_version_id uuid,p_category text,p_title text,p_description text,p_image_path text,p_audio_fr_path text,p_audio_wo_path text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
  if nullif(btrim(p_category),'') is null or nullif(btrim(p_title),'') is null then raise exception 'Category and title required' using errcode='22023'; end if;
  if not exists(select 1 from public.cms_panel_versions where id=p_version_id and panel_id=p_panel_id and status='draft') then raise exception 'Draft not found' using errcode='22023'; end if;
  update public.cms_panels set category=p_category where id=p_panel_id;
  update public.cms_panel_versions set title=p_title,description=nullif(p_description,''),image_path=nullif(p_image_path,''),audio_fr_path=nullif(p_audio_fr_path,''),audio_wo_path=nullif(p_audio_wo_path,'') where id=p_version_id;
  return true;
end;
$$;

create or replace function public.publish_cms_panel_version(p_panel_id uuid,p_version_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_old uuid;
begin
  if not public.is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
  select current_version_id into v_old from public.cms_panels where id=p_panel_id for update;
  if not found then raise exception 'Panel not found' using errcode='22023'; end if;
  if not exists(select 1 from public.cms_panel_versions where id=p_version_id and panel_id=p_panel_id and status='draft') then raise exception 'Draft not found' using errcode='22023'; end if;
  if v_old is not null then update public.cms_panel_versions set status='archived' where id=v_old; end if;
  update public.cms_panel_versions set status='published' where id=p_version_id;
  update public.cms_panels set current_version_id=p_version_id where id=p_panel_id;
  return true;
end;
$$;

create or replace function public.restore_cms_panel_version_as_draft(p_panel_id uuid,p_source_version_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_new uuid; v_next integer; v_src public.cms_panel_versions%rowtype;
begin
  if not public.is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
  if exists(select 1 from public.cms_panel_versions where panel_id=p_panel_id and status='draft') then raise exception 'A draft already exists' using errcode='23505'; end if;
  select * into v_src from public.cms_panel_versions where id=p_source_version_id and panel_id=p_panel_id;
  if not found then raise exception 'Source version not found' using errcode='22023'; end if;
  select coalesce(max(version_number),0)+1 into v_next from public.cms_panel_versions where panel_id=p_panel_id;
  v_new:=gen_random_uuid();
  insert into public.cms_panel_versions(id,panel_id,status,version_number,title,description,image_path,audio_fr_path,audio_wo_path,sort_order)
  values(v_new,p_panel_id,'draft',v_next,v_src.title,v_src.description,v_src.image_path,v_src.audio_fr_path,v_src.audio_wo_path,v_src.sort_order);
  return v_new;
end;
$$;

create or replace function public.delete_cms_panel_version(p_panel_id uuid,p_version_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_current uuid; v_ver public.cms_panel_versions%rowtype;
begin
  if not public.is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
  select current_version_id into v_current from public.cms_panels where id=p_panel_id for update;
  if not found then raise exception 'Panel not found' using errcode='22023'; end if;
  if v_current=p_version_id then raise exception 'Active version cannot be deleted' using errcode='42501'; end if;
  select * into v_ver from public.cms_panel_versions where id=p_version_id and panel_id=p_panel_id;
  if not found then return false; end if;
  insert into public.cms_content_versions(entity_type,entity_id,version_number,snapshot,created_by)
  values('cms_panel_version_deleted',p_panel_id,v_ver.version_number,to_jsonb(v_ver),auth.uid()) on conflict do nothing;
  delete from public.cms_panel_versions where id=p_version_id;
  return found;
end;
$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('cms-media','cms-media',true,15728640,array['image/jpeg','image/png','image/webp','image/gif','audio/mpeg','audio/mp4','audio/wav','audio/ogg','audio/webm'])
on conflict(id) do update set public=true,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "cms_media_admin_insert" on storage.objects;
create policy "cms_media_admin_insert" on storage.objects for insert to authenticated with check(bucket_id='cms-media' and public.is_admin());
drop policy if exists "cms_media_admin_update" on storage.objects;
create policy "cms_media_admin_update" on storage.objects for update to authenticated using(bucket_id='cms-media' and public.is_admin()) with check(bucket_id='cms-media' and public.is_admin());
drop policy if exists "cms_media_admin_delete" on storage.objects;
create policy "cms_media_admin_delete" on storage.objects for delete to authenticated using(bucket_id='cms-media' and public.is_admin());

revoke execute on function public.admin_seed_lesson(text,text,text,text,integer) from public,anon;
revoke execute on function public.create_cms_lesson_draft(uuid) from public,anon;
revoke execute on function public.save_cms_lesson_draft(uuid,uuid,text,text,jsonb) from public,anon;
revoke execute on function public.publish_cms_lesson_version(uuid,uuid) from public,anon;
revoke execute on function public.restore_cms_lesson_version_as_draft(uuid,uuid) from public,anon;
revoke execute on function public.delete_cms_lesson_version(uuid,uuid) from public,anon;
revoke execute on function public.admin_seed_panel(text,text,text,text,text,integer) from public,anon;
revoke execute on function public.create_cms_panel_draft(uuid) from public,anon;
revoke execute on function public.save_cms_panel_draft(uuid,uuid,text,text,text,text,text,text) from public,anon;
revoke execute on function public.publish_cms_panel_version(uuid,uuid) from public,anon;
revoke execute on function public.restore_cms_panel_version_as_draft(uuid,uuid) from public,anon;
revoke execute on function public.delete_cms_panel_version(uuid,uuid) from public,anon;

grant execute on function public.admin_seed_lesson(text,text,text,text,integer) to authenticated;
grant execute on function public.create_cms_lesson_draft(uuid) to authenticated;
grant execute on function public.save_cms_lesson_draft(uuid,uuid,text,text,jsonb) to authenticated;
grant execute on function public.publish_cms_lesson_version(uuid,uuid) to authenticated;
grant execute on function public.restore_cms_lesson_version_as_draft(uuid,uuid) to authenticated;
grant execute on function public.delete_cms_lesson_version(uuid,uuid) to authenticated;
grant execute on function public.admin_seed_panel(text,text,text,text,text,integer) to authenticated;
grant execute on function public.create_cms_panel_draft(uuid) to authenticated;
grant execute on function public.save_cms_panel_draft(uuid,uuid,text,text,text,text,text,text) to authenticated;
grant execute on function public.publish_cms_panel_version(uuid,uuid) to authenticated;
grant execute on function public.restore_cms_panel_version_as_draft(uuid,uuid) to authenticated;
grant execute on function public.delete_cms_panel_version(uuid,uuid) to authenticated;
