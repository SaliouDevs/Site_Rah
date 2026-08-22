-- V3.4 instructor actions, school management and richer scheduling.

create or replace function public.instructor_schedule_activity(
  p_assignment_id uuid,
  p_session_type text,
  p_scheduled_at timestamptz,
  p_duration_minutes integer default 60,
  p_location text default null,
  p_theme text default null,
  p_focus text default null
)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_student uuid; v_label text;
begin
  if p_session_type not in ('driving','theory') then raise exception 'Invalid session type' using errcode='22023'; end if;
  if p_duration_minutes not between 15 and 240 then raise exception 'Invalid duration' using errcode='22023'; end if;
  select student_id into v_student from public.instructor_assignments where id=p_assignment_id and status='active' and (instructor_id=auth.uid() or public.is_admin());
  if v_student is null then raise exception 'Assignment denied' using errcode='42501'; end if;
  insert into public.driving_sessions(assignment_id,scheduled_at,duration_minutes,location,focus,created_by,session_type,theme)
  values(p_assignment_id,p_scheduled_at,p_duration_minutes,nullif(btrim(p_location),''),nullif(btrim(p_focus),''),auth.uid(),p_session_type,nullif(btrim(p_theme),'')) returning id into v_id;
  v_label:=case p_session_type when 'theory' then 'Cours théorique' else 'Cours de conduite' end;
  perform public.notify_user(v_student,'session.scheduled','Nouveau cours programmé',v_label,jsonb_build_object('sessionId',v_id,'scheduledAt',p_scheduled_at,'location',p_location,'type',p_session_type,'theme',p_theme),auth.uid());
  return v_id;
end $$;

create or replace function public.instructor_update_activity(
  p_session_id uuid,
  p_status text,
  p_attendance text default 'unknown',
  p_comment text default null
)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_student uuid; v_assignment uuid; v_label text;
begin
  if p_status not in ('planned','completed','cancelled') then raise exception 'Invalid session status' using errcode='22023'; end if;
  if p_attendance not in ('unknown','present','absent') then raise exception 'Invalid attendance' using errcode='22023'; end if;
  update public.driving_sessions s
     set status=p_status,attendance=p_attendance,instructor_comment=nullif(btrim(p_comment),''),updated_at=now()
   where s.id=p_session_id
     and exists(select 1 from public.instructor_assignments a where a.id=s.assignment_id and (a.instructor_id=auth.uid() or public.is_admin()))
   returning assignment_id into v_assignment;
  if v_assignment is null then return false; end if;
  select student_id into v_student from public.instructor_assignments where id=v_assignment;
  if p_attendance='absent' then
    perform public.notify_admins('session.absent','Élève absent à un cours',(select prenom from public.profiles where id=v_student),jsonb_build_object('sessionId',p_session_id,'studentId',v_student),auth.uid());
  end if;
  if p_status in ('completed','cancelled') then
    v_label:=case p_status when 'completed' then 'Cours terminé' else 'Cours annulé' end;
    perform public.notify_user(v_student,'session.updated',v_label,coalesce(p_comment,''),jsonb_build_object('sessionId',p_session_id,'status',p_status,'attendance',p_attendance),auth.uid());
  end if;
  return true;
end $$;

create or replace function public.student_update_recommendation(p_recommendation_id uuid,p_status text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if p_status not in ('active','completed','dismissed') then raise exception 'Invalid recommendation status' using errcode='22023'; end if;
  update public.instructor_recommendations r
     set status=p_status,completed_at=case when p_status='completed' then now() else null end
   where r.id=p_recommendation_id
     and exists(select 1 from public.instructor_assignments a where a.id=r.assignment_id and a.student_id=auth.uid());
  return found;
end $$;

create or replace function public.admin_upsert_driving_school(
  p_id uuid,
  p_name text,
  p_slug text,
  p_phone text default null,
  p_email text default null,
  p_address text default null,
  p_city text default null,
  p_commission_rate numeric default 25,
  p_status text default 'active'
)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid:=coalesce(p_id,gen_random_uuid());
begin
  if not public.is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
  if nullif(btrim(p_name),'') is null or nullif(btrim(p_slug),'') is null then raise exception 'Name and slug required' using errcode='22023'; end if;
  if p_commission_rate<0 or p_commission_rate>100 then raise exception 'Invalid commission rate' using errcode='22023'; end if;
  if p_status not in ('active','inactive') then raise exception 'Invalid status' using errcode='22023'; end if;
  insert into public.driving_schools(id,name,slug,status,phone,email,address,city,commission_rate,updated_at)
  values(v_id,btrim(p_name),lower(regexp_replace(btrim(p_slug),'[^a-zA-Z0-9_-]+','-','g')),p_status,nullif(btrim(p_phone),''),nullif(btrim(p_email),''),nullif(btrim(p_address),''),nullif(btrim(p_city),''),p_commission_rate,now())
  on conflict(id) do update set name=excluded.name,slug=excluded.slug,status=excluded.status,phone=excluded.phone,email=excluded.email,address=excluded.address,city=excluded.city,commission_rate=excluded.commission_rate,updated_at=now();
  return v_id;
end $$;

create or replace function public.admin_assign_instructor_school(p_instructor_id uuid,p_school_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
  if not exists(select 1 from public.profiles where id=p_instructor_id and account_role='instructor') then raise exception 'Instructor not found' using errcode='22023'; end if;
  if not exists(select 1 from public.driving_schools where id=p_school_id and status='active') then raise exception 'School not found' using errcode='22023'; end if;
  update public.profiles set driving_school_id=p_school_id where id=p_instructor_id;
  return found;
end $$;

create or replace function public.get_instructor_profile_workspace()
returns jsonb language sql stable security definer set search_path='' as $$
select case when not public.is_instructor() then null else jsonb_build_object(
  'profile',(select jsonb_build_object('id',p.id,'name',p.prenom,'phone',p.telephone,'photoUrl',p.photo_url,'status',p.status,'schoolId',p.driving_school_id) from public.profiles p where p.id=auth.uid()),
  'school',(select jsonb_build_object('id',s.id,'name',s.name,'phone',s.phone,'email',s.email,'address',s.address,'city',s.city,'commissionRate',s.commission_rate) from public.profiles p join public.driving_schools s on s.id=p.driving_school_id where p.id=auth.uid())
) end;
$$;

revoke execute on function public.instructor_schedule_activity(uuid,text,timestamptz,integer,text,text,text) from public,anon;
revoke execute on function public.instructor_update_activity(uuid,text,text,text) from public,anon;
revoke execute on function public.student_update_recommendation(uuid,text) from public,anon;
revoke execute on function public.admin_upsert_driving_school(uuid,text,text,text,text,text,text,numeric,text) from public,anon;
revoke execute on function public.admin_assign_instructor_school(uuid,uuid) from public,anon;
revoke execute on function public.get_instructor_profile_workspace() from public,anon;
grant execute on function public.instructor_schedule_activity(uuid,text,timestamptz,integer,text,text,text) to authenticated;
grant execute on function public.instructor_update_activity(uuid,text,text,text) to authenticated;
grant execute on function public.student_update_recommendation(uuid,text) to authenticated;
grant execute on function public.admin_upsert_driving_school(uuid,text,text,text,text,text,text,numeric,text) to authenticated;
grant execute on function public.admin_assign_instructor_school(uuid,uuid) to authenticated;
grant execute on function public.get_instructor_profile_workspace() to authenticated;
