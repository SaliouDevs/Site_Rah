-- V3.4 support: private message media, detailed student analytics, reminders and admin workspaces.

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'instructor-messages','instructor-messages',false,52428800,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif','audio/mpeg','audio/mp4','audio/x-m4a','audio/wav','audio/ogg','audio/aac','video/mp4','video/quicktime','video/webm','application/pdf','text/plain']::text[]
)
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.can_access_assignment(p_assignment_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select public.is_admin() or exists(
    select 1 from public.instructor_assignments a
    where a.id=p_assignment_id and a.status='active'
      and (a.instructor_id=auth.uid() or a.student_id=auth.uid())
  );
$$;
revoke execute on function public.can_access_assignment(uuid) from public,anon;
grant execute on function public.can_access_assignment(uuid) to authenticated;

create or replace function public.get_instructor_student_detail(p_assignment_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
with a as (
  select ia.*, p.prenom,p.telephone,p.photo_url,p.status as profile_status
  from public.instructor_assignments ia join public.profiles p on p.id=ia.student_id
  where ia.id=p_assignment_id and ia.status='active' and (ia.instructor_id=auth.uid() or public.is_admin())
), attempts as (
  select l.* from public.learning_attempts l where l.user_id=(select student_id from a)
), topic_stats as (
  select topic,count(*)::int attempts,
    count(*) filter(where is_correct is true)::int correct,
    round(100.0*count(*) filter(where is_correct is true)/nullif(count(*) filter(where is_correct is not null),0))::int accuracy
  from attempts where topic is not null and is_correct is not null group by topic
), type_stats as (
  select activity_type,count(*)::int attempts,
    count(*) filter(where is_correct is true)::int correct,
    round(100.0*count(*) filter(where is_correct is true)/nullif(count(*) filter(where is_correct is not null),0))::int accuracy
  from attempts group by activity_type
)
select case when not exists(select 1 from a) then null else jsonb_build_object(
  'student',(select jsonb_build_object('id',student_id,'prenom',prenom,'telephone',telephone,'photoUrl',photo_url,'status',profile_status,'readinessStatus',readiness_status) from a),
  'points',(select coalesce(sum(points),0)::int from public.learning_points_ledger where user_id=(select student_id from a)),
  'answered',(select count(*)::int from attempts where is_correct is not null),
  'correct',(select count(*)::int from attempts where is_correct is true),
  'accuracy',(select case when count(*) filter(where is_correct is not null)>0 then round(100.0*count(*) filter(where is_correct is true)/count(*) filter(where is_correct is not null))::int else 0 end from attempts),
  'activityStats',coalesce((select jsonb_agg(jsonb_build_object('type',activity_type,'attempts',attempts,'correct',correct,'accuracy',coalesce(accuracy,0)) order by activity_type) from type_stats),'[]'::jsonb),
  'weakTopics',coalesce((select jsonb_agg(jsonb_build_object('topic',topic,'attempts',attempts,'correct',correct,'accuracy',coalesce(accuracy,0)) order by coalesce(accuracy,0),attempts desc) from (select * from topic_stats where attempts>=2 order by coalesce(accuracy,0),attempts desc limit 8) q),'[]'::jsonb),
  'strongTopics',coalesce((select jsonb_agg(jsonb_build_object('topic',topic,'attempts',attempts,'correct',correct,'accuracy',coalesce(accuracy,0)) order by coalesce(accuracy,0) desc,attempts desc) from (select * from topic_stats where attempts>=2 order by coalesce(accuracy,0) desc,attempts desc limit 6) q),'[]'::jsonb),
  'sessions',coalesce((select jsonb_agg(to_jsonb(q) order by q.scheduled_at desc) from (select * from public.driving_sessions s where s.assignment_id=p_assignment_id order by s.scheduled_at desc limit 50) q),'[]'::jsonb),
  'exams',coalesce((select jsonb_agg(to_jsonb(q) order by q.scheduled_at desc) from (select * from public.student_exams e where e.assignment_id=p_assignment_id order by e.scheduled_at desc limit 50) q),'[]'::jsonb),
  'evaluations',coalesce((select jsonb_agg(to_jsonb(q) order by q.evaluation_date desc,q.created_at desc) from (select * from public.driving_evaluations d where d.assignment_id=p_assignment_id order by d.evaluation_date desc,d.created_at desc limit 50) q),'[]'::jsonb),
  'goals',coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc) from (select * from public.instructor_goals g where g.assignment_id=p_assignment_id order by g.created_at desc limit 50) q),'[]'::jsonb),
  'recommendations',coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc) from (select * from public.instructor_recommendations r where r.assignment_id=p_assignment_id order by r.created_at desc limit 50) q),'[]'::jsonb)
) end;
$$;
revoke execute on function public.get_instructor_student_detail(uuid) from public,anon;
grant execute on function public.get_instructor_student_detail(uuid) to authenticated;

create or replace function public.get_assignment_messages(p_assignment_id uuid,p_limit integer default 100)
returns setof public.instructor_messages language sql stable security definer set search_path='' as $$
  select m.* from public.instructor_messages m
  where m.assignment_id=p_assignment_id and public.can_access_assignment(p_assignment_id)
  order by m.created_at asc limit greatest(1,least(coalesce(p_limit,100),200));
$$;
revoke execute on function public.get_assignment_messages(uuid,integer) from public,anon;
grant execute on function public.get_assignment_messages(uuid,integer) to authenticated;

create or replace function public.get_admin_link_requests()
returns jsonb language sql stable security definer set search_path='' as $$
select case when not public.is_admin() then '[]'::jsonb else coalesce(jsonb_agg(jsonb_build_object(
  'id',r.id,'status',r.status,'requestedAt',r.requested_at,'reviewedAt',r.reviewed_at,'adminNote',r.admin_note,
  'instructorId',r.instructor_id,'instructorName',i.prenom,'instructorPhone',i.telephone,
  'studentId',r.student_id,'studentName',s.prenom,'studentPhone',s.telephone,'studentStatus',s.status,
  'paymentVerified',s.payment_verified_at is not null,'paymentSource',s.payment_source,
  'schoolId',r.driving_school_id,'schoolName',ds.name
) order by r.requested_at desc),'[]'::jsonb) end
from public.instructor_link_requests r
join public.profiles i on i.id=r.instructor_id
join public.profiles s on s.id=r.student_id
join public.driving_schools ds on ds.id=r.driving_school_id;
$$;
revoke execute on function public.get_admin_link_requests() from public,anon;
grant execute on function public.get_admin_link_requests() to authenticated;

create or replace function public.get_admin_payments_workspace()
returns jsonb language sql stable security definer set search_path='' as $$
select case when not public.is_admin() then null else jsonb_build_object(
  'payments',coalesce((select jsonb_agg(jsonb_build_object(
    'id',p.id,'userId',p.user_id,'studentName',pr.prenom,'studentPhone',pr.telephone,'amount',p.amount,'currency',p.currency,
    'status',p.status,'transactionId',p.transaction_id,'checkoutId',p.checkout_id,'clientReference',p.client_reference,
    'confirmedAt',p.confirmed_at,'createdAt',p.created_at,'schoolId',p.driving_school_id,'schoolName',ds.name
  ) order by p.created_at desc) from public.platform_payments p join public.profiles pr on pr.id=p.user_id left join public.driving_schools ds on ds.id=p.driving_school_id),'[]'::jsonb),
  'commissions',coalesce((select jsonb_agg(jsonb_build_object(
    'id',c.id,'paymentId',c.payment_id,'schoolId',c.driving_school_id,'schoolName',ds.name,'rate',c.commission_rate,'amount',c.amount,
    'periodStart',c.period_start,'periodEnd',c.period_end,'status',c.status,'settlementId',c.settlement_id,'createdAt',c.created_at
  ) order by c.created_at desc) from public.school_commissions c join public.driving_schools ds on ds.id=c.driving_school_id),'[]'::jsonb),
  'settlements',coalesce((select jsonb_agg(jsonb_build_object(
    'id',s.id,'schoolId',s.driving_school_id,'schoolName',ds.name,'periodStart',s.period_start,'periodEnd',s.period_end,'amount',s.amount,
    'status',s.status,'paidAt',s.paid_at,'reference',s.payment_reference,'observation',s.observation,'createdAt',s.created_at
  ) order by s.created_at desc) from public.commission_settlements s join public.driving_schools ds on ds.id=s.driving_school_id),'[]'::jsonb),
  'schools',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'slug',slug,'status',status,'commissionRate',commission_rate,'phone',phone,'email',email,'city',city) order by name) from public.driving_schools),'[]'::jsonb)
) end;
$$;
revoke execute on function public.get_admin_payments_workspace() from public,anon;
grant execute on function public.get_admin_payments_workspace() to authenticated;

create table if not exists public.notification_reminder_log (
  reminder_key text primary key,
  created_at timestamptz not null default now()
);
alter table public.notification_reminder_log enable row level security;
revoke all on public.notification_reminder_log from anon,authenticated;

create or replace function public.generate_due_reminders()
returns integer language plpgsql security definer set search_path='' as $$
declare r record; v_key text; v_count integer:=0;
begin
  for r in
    select s.id,s.scheduled_at,s.location,s.session_type,a.instructor_id,a.student_id
    from public.driving_sessions s join public.instructor_assignments a on a.id=s.assignment_id
    where s.status='planned' and s.scheduled_at between now()+interval '23 hours' and now()+interval '25 hours'
  loop
    v_key:='session:'||r.id||':'||to_char(r.scheduled_at at time zone 'UTC','YYYYMMDDHH24MI');
    if not exists(select 1 from public.notification_reminder_log where reminder_key=v_key) then
      insert into public.notification_reminder_log(reminder_key) values(v_key);
      perform public.notify_user(r.instructor_id,'reminder.session','Cours prévu demain',case r.session_type when 'theory' then 'Cours théorique' else 'Cours de conduite' end,jsonb_build_object('sessionId',r.id,'scheduledAt',r.scheduled_at,'location',r.location),null);
      perform public.notify_user(r.student_id,'reminder.session','Cours prévu demain',case r.session_type when 'theory' then 'Cours théorique' else 'Cours de conduite' end,jsonb_build_object('sessionId',r.id,'scheduledAt',r.scheduled_at,'location',r.location),null);
      v_count:=v_count+2;
    end if;
  end loop;
  for r in
    select e.id,e.scheduled_at,e.location,e.exam_type,a.instructor_id,a.student_id
    from public.student_exams e join public.instructor_assignments a on a.id=e.assignment_id
    where e.status='scheduled' and e.scheduled_at between now()+interval '23 hours' and now()+interval '25 hours'
  loop
    v_key:='exam:'||r.id||':'||to_char(r.scheduled_at at time zone 'UTC','YYYYMMDDHH24MI');
    if not exists(select 1 from public.notification_reminder_log where reminder_key=v_key) then
      insert into public.notification_reminder_log(reminder_key) values(v_key);
      perform public.notify_user(r.instructor_id,'reminder.exam','Examen prévu demain','Un examen est programmé demain.',jsonb_build_object('examId',r.id,'scheduledAt',r.scheduled_at,'location',r.location,'type',r.exam_type),null);
      perform public.notify_user(r.student_id,'reminder.exam','Examen prévu demain','Votre examen est programmé demain.',jsonb_build_object('examId',r.id,'scheduledAt',r.scheduled_at,'location',r.location,'type',r.exam_type),null);
      v_count:=v_count+2;
    end if;
  end loop;
  return v_count;
end $$;
revoke execute on function public.generate_due_reminders() from public,anon,authenticated;

create extension if not exists pg_cron with schema extensions;
do $$
begin
  if not exists(select 1 from cron.job where jobname='eautoecole-due-reminders') then
    perform cron.schedule('eautoecole-due-reminders','15 * * * *','select public.generate_due_reminders();');
  end if;
end $$;
