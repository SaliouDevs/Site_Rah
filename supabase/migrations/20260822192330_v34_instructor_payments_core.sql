-- V3.4 Instructor workspace, notifications, messaging, scheduling, exams,
-- driving logbook, school partnerships, Wave payment ledger and commissions.

create table if not exists public.driving_schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active' check (status in ('active','inactive')),
  phone text,
  email text,
  address text,
  city text,
  commission_rate numeric(5,2) not null default 25.00 check (commission_rate >= 0 and commission_rate <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.driving_schools(name,slug,city)
select coalesce((select school_name from public.school_settings where id='global'),'Auto-école'),
       'eautoecole-default',
       coalesce((select city from public.school_settings where id='global'),'Dakar')
where not exists(select 1 from public.driving_schools where slug='eautoecole-default');

alter table public.profiles add column if not exists driving_school_id uuid references public.driving_schools(id) on delete set null;
alter table public.profiles add column if not exists payment_verified_at timestamptz;
alter table public.profiles add column if not exists payment_source text;

update public.profiles
set payment_verified_at = coalesce(payment_verified_at, created_at),
    payment_source = coalesce(payment_source, 'legacy')
where account_role='student' and status='active' and payment_verified_at is null;

update public.profiles
set driving_school_id = (select id from public.driving_schools where slug='eautoecole-default')
where account_role='instructor' and driving_school_id is null;

alter table public.instructor_assignments add column if not exists readiness_status text not null default 'training';
alter table public.instructor_assignments add column if not exists approved_at timestamptz;
alter table public.instructor_assignments add column if not exists approved_by uuid references auth.users(id) on delete set null;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='instructor_assignments_readiness_check') then
    alter table public.instructor_assignments add constraint instructor_assignments_readiness_check
      check (readiness_status in ('training','preparing','ready','needs_work'));
  end if;
end $$;

alter table public.driving_sessions add column if not exists session_type text not null default 'driving';
alter table public.driving_sessions add column if not exists attendance text not null default 'unknown';
alter table public.driving_sessions add column if not exists theme text;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='driving_sessions_type_check') then
    alter table public.driving_sessions add constraint driving_sessions_type_check check (session_type in ('driving','theory'));
  end if;
  if not exists(select 1 from pg_constraint where conname='driving_sessions_attendance_check') then
    alter table public.driving_sessions add constraint driving_sessions_attendance_check check (attendance in ('unknown','present','absent'));
  end if;
end $$;

create table if not exists public.user_presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  category text not null,
  title text not null,
  body text,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_notifications_recipient_created on public.app_notifications(recipient_id,created_at desc);
create index if not exists idx_notifications_recipient_unread on public.app_notifications(recipient_id,created_at desc) where read_at is null;

create table if not exists public.instructor_link_requests (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  driving_school_id uuid not null references public.driving_schools(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  admin_note text,
  check (instructor_id <> student_id)
);
create unique index if not exists uq_link_request_pending on public.instructor_link_requests(instructor_id,student_id) where status='pending';
create index if not exists idx_link_requests_status_date on public.instructor_link_requests(status,requested_at desc);

create table if not exists public.instructor_messages (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.instructor_assignments(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  message_kind text not null default 'text' check (message_kind in ('text','audio','image','video','document')),
  body text,
  media_path text,
  mime_type text,
  seen_at timestamptz,
  created_at timestamptz not null default now(),
  check (body is not null or media_path is not null)
);
create index if not exists idx_instructor_messages_assignment_created on public.instructor_messages(assignment_id,created_at desc);

create table if not exists public.instructor_recommendations (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.instructor_assignments(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  recommendation_type text not null check (recommendation_type in ('lesson','test','video')),
  target_key text,
  title text not null,
  note text,
  status text not null default 'active' check (status in ('active','completed','dismissed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists idx_instructor_recommendations_assignment on public.instructor_recommendations(assignment_id,status,created_at desc);

create table if not exists public.student_exams (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.instructor_assignments(id) on delete cascade,
  exam_type text not null check (exam_type in ('code_theory','code_oral','driving')),
  scheduled_at timestamptz not null,
  location text,
  status text not null default 'scheduled' check (status in ('scheduled','passed','failed','cancelled')),
  observation text,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_student_exams_assignment_date on public.student_exams(assignment_id,scheduled_at desc);

create table if not exists public.driving_evaluations (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.instructor_assignments(id) on delete cascade,
  session_id uuid references public.driving_sessions(id) on delete set null,
  evaluation_date date not null default current_date,
  duration_minutes integer not null check (duration_minutes between 15 and 360),
  location text,
  ratings jsonb not null default '{}'::jsonb,
  overall_score numeric(4,2) not null check (overall_score >= 0 and overall_score <= 10),
  comment text,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists idx_driving_evaluations_assignment_date on public.driving_evaluations(assignment_id,evaluation_date desc,created_at desc);

create table if not exists public.platform_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  driving_school_id uuid references public.driving_schools(id) on delete set null,
  provider text not null default 'wave' check (provider='wave'),
  client_reference text not null unique,
  checkout_id text unique,
  transaction_id text unique,
  amount integer not null default 2000 check (amount > 0),
  currency text not null default 'XOF' check (currency='XOF'),
  status text not null default 'initiated' check (status in ('initiated','processing','succeeded','failed','cancelled','expired','refunded')),
  payer_mobile text,
  launch_url text,
  provider_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists idx_platform_payments_user_created on public.platform_payments(user_id,created_at desc);
create index if not exists idx_platform_payments_status_created on public.platform_payments(status,created_at desc);

create table if not exists public.wave_webhook_events (
  event_id text primary key,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz not null default now(),
  result text not null default 'processed'
);

create table if not exists public.commission_settlements (
  id uuid primary key default gen_random_uuid(),
  driving_school_id uuid not null references public.driving_schools(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  amount integer not null check (amount >= 0),
  status text not null default 'pending' check (status in ('pending','paid','cancelled')),
  paid_at timestamptz,
  payment_reference text,
  observation text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);
create index if not exists idx_commission_settlements_school_date on public.commission_settlements(driving_school_id,period_end desc);

create table if not exists public.school_commissions (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null unique references public.platform_payments(id) on delete restrict,
  driving_school_id uuid not null references public.driving_schools(id) on delete restrict,
  commission_rate numeric(5,2) not null,
  amount integer not null check (amount >= 0),
  period_start date not null,
  period_end date not null,
  status text not null default 'accrued' check (status in ('accrued','settled','void')),
  settlement_id uuid references public.commission_settlements(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_school_commissions_school_status on public.school_commissions(driving_school_id,status,period_end desc);

alter table public.driving_schools enable row level security;
alter table public.user_presence enable row level security;
alter table public.app_notifications enable row level security;
alter table public.instructor_link_requests enable row level security;
alter table public.instructor_messages enable row level security;
alter table public.instructor_recommendations enable row level security;
alter table public.student_exams enable row level security;
alter table public.driving_evaluations enable row level security;
alter table public.platform_payments enable row level security;
alter table public.wave_webhook_events enable row level security;
alter table public.commission_settlements enable row level security;
alter table public.school_commissions enable row level security;

drop policy if exists driving_schools_read_authenticated on public.driving_schools;
create policy driving_schools_read_authenticated on public.driving_schools for select to authenticated using (true);
drop policy if exists notifications_read_own on public.app_notifications;
create policy notifications_read_own on public.app_notifications for select to authenticated using (recipient_id=(select auth.uid()));
drop policy if exists link_requests_read_scoped on public.instructor_link_requests;
create policy link_requests_read_scoped on public.instructor_link_requests for select to authenticated using (public.is_admin() or instructor_id=(select auth.uid()) or student_id=(select auth.uid()));
drop policy if exists messages_read_participants on public.instructor_messages;
create policy messages_read_participants on public.instructor_messages for select to authenticated using (public.is_admin() or exists(select 1 from public.instructor_assignments a where a.id=instructor_messages.assignment_id and a.status='active' and (a.instructor_id=(select auth.uid()) or a.student_id=(select auth.uid()))));
drop policy if exists recommendations_read_participants on public.instructor_recommendations;
create policy recommendations_read_participants on public.instructor_recommendations for select to authenticated using (public.is_admin() or exists(select 1 from public.instructor_assignments a where a.id=instructor_recommendations.assignment_id and (a.instructor_id=(select auth.uid()) or a.student_id=(select auth.uid()))));
drop policy if exists exams_read_participants on public.student_exams;
create policy exams_read_participants on public.student_exams for select to authenticated using (public.is_admin() or exists(select 1 from public.instructor_assignments a where a.id=student_exams.assignment_id and (a.instructor_id=(select auth.uid()) or a.student_id=(select auth.uid()))));
drop policy if exists evaluations_read_participants on public.driving_evaluations;
create policy evaluations_read_participants on public.driving_evaluations for select to authenticated using (public.is_admin() or exists(select 1 from public.instructor_assignments a where a.id=driving_evaluations.assignment_id and (a.instructor_id=(select auth.uid()) or a.student_id=(select auth.uid()))));
drop policy if exists payments_read_own on public.platform_payments;
create policy payments_read_own on public.platform_payments for select to authenticated using (user_id=(select auth.uid()) or public.is_admin());
drop policy if exists settlements_admin_read on public.commission_settlements;
create policy settlements_admin_read on public.commission_settlements for select to authenticated using (public.is_admin());
drop policy if exists commissions_admin_read on public.school_commissions;
create policy commissions_admin_read on public.school_commissions for select to authenticated using (public.is_admin());

revoke insert,update,delete on public.driving_schools from anon,authenticated;
revoke insert,update,delete on public.user_presence from anon,authenticated;
revoke insert,update,delete on public.app_notifications from anon,authenticated;
revoke insert,update,delete on public.instructor_link_requests from anon,authenticated;
revoke insert,update,delete on public.instructor_messages from anon,authenticated;
revoke insert,update,delete on public.instructor_recommendations from anon,authenticated;
revoke insert,update,delete on public.student_exams from anon,authenticated;
revoke insert,update,delete on public.driving_evaluations from anon,authenticated;
revoke insert,update,delete on public.platform_payments from anon,authenticated;
revoke all on public.wave_webhook_events from anon,authenticated;
revoke insert,update,delete on public.commission_settlements from anon,authenticated;
revoke insert,update,delete on public.school_commissions from anon,authenticated;
grant select on public.driving_schools,public.app_notifications,public.instructor_link_requests,public.instructor_messages,public.instructor_recommendations,public.student_exams,public.driving_evaluations,public.platform_payments to authenticated;
grant select on public.commission_settlements,public.school_commissions to authenticated;

create or replace function public.notify_user(p_recipient uuid,p_category text,p_title text,p_body text default null,p_data jsonb default '{}'::jsonb,p_actor uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if p_recipient is null then return null; end if;
  insert into public.app_notifications(recipient_id,actor_id,category,title,body,data)
  values(p_recipient,p_actor,p_category,p_title,p_body,coalesce(p_data,'{}'::jsonb)) returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.notify_user(uuid,text,text,text,jsonb,uuid) from public,anon,authenticated;

create or replace function public.notify_admins(p_category text,p_title text,p_body text default null,p_data jsonb default '{}'::jsonb,p_actor uuid default null)
returns integer language plpgsql security definer set search_path='' as $$
declare v_admin uuid; v_count integer:=0;
begin
  for v_admin in select id from auth.users where coalesce(raw_app_meta_data->>'role','')='admin' loop
    perform public.notify_user(v_admin,p_category,p_title,p_body,p_data,p_actor);
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$;
revoke execute on function public.notify_admins(text,text,text,jsonb,uuid) from public,anon,authenticated;

create or replace function public.on_profile_registration_notify()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.account_role='student' then
    perform public.notify_admins('registration.created','Nouvelle inscription',coalesce(new.prenom,'Élève')||' · '||coalesce(new.telephone,''),jsonb_build_object('userId',new.id,'status',new.status),new.id);
  end if;
  return new;
end $$;
drop trigger if exists trg_profile_registration_notify on public.profiles;
create trigger trg_profile_registration_notify after insert on public.profiles for each row execute function public.on_profile_registration_notify();

create or replace function public.touch_user_presence()
returns timestamptz language plpgsql security definer set search_path='' as $$
declare v_now timestamptz:=now();
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  insert into public.user_presence(user_id,last_seen_at,updated_at) values(auth.uid(),v_now,v_now)
  on conflict(user_id) do update set last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at;
  return v_now;
end $$;

create or replace function public.get_my_notifications(p_limit integer default 40)
returns setof public.app_notifications language sql stable security definer set search_path='' as $$
  select * from public.app_notifications where recipient_id=auth.uid() order by created_at desc limit greatest(1,least(coalesce(p_limit,40),100));
$$;
create or replace function public.mark_notification_read(p_notification_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin update public.app_notifications set read_at=coalesce(read_at,now()) where id=p_notification_id and recipient_id=auth.uid(); return found; end $$;
create or replace function public.mark_all_notifications_read()
returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer; begin update public.app_notifications set read_at=coalesce(read_at,now()) where recipient_id=auth.uid() and read_at is null; get diagnostics v_count=row_count; return v_count; end $$;

create or replace function public.instructor_request_student_link(p_phone text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_instructor uuid:=auth.uid(); v_student public.profiles%rowtype; v_school uuid; v_request uuid; v_digits text;
begin
  if not public.is_instructor() or public.is_admin() then raise exception 'Instructor required' using errcode='42501'; end if;
  v_digits:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'); if left(v_digits,3)='221' then v_digits:=substr(v_digits,4); end if;
  select * into v_student from public.profiles where regexp_replace(telephone,'[^0-9]','','g')=v_digits and account_role='student' limit 1;
  if not found then return jsonb_build_object('state','not_found'); end if;
  select driving_school_id into v_school from public.profiles where id=v_instructor;
  if v_school is null then return jsonb_build_object('state','instructor_without_school'); end if;
  if v_student.status<>'active' or v_student.payment_verified_at is null then return jsonb_build_object('state','payment_required','studentId',v_student.id,'studentName',v_student.prenom,'price',2000); end if;
  if exists(select 1 from public.instructor_assignments where student_id=v_student.id and status='active' and instructor_id=v_instructor) then return jsonb_build_object('state','already_linked','studentId',v_student.id,'studentName',v_student.prenom); end if;
  if exists(select 1 from public.instructor_assignments where student_id=v_student.id and status='active' and instructor_id<>v_instructor) then return jsonb_build_object('state','assigned_elsewhere','studentId',v_student.id,'studentName',v_student.prenom); end if;
  insert into public.instructor_link_requests(instructor_id,student_id,driving_school_id) values(v_instructor,v_student.id,v_school)
  on conflict(instructor_id,student_id) where status='pending' do update set requested_at=now() returning id into v_request;
  perform public.notify_admins('instructor.link_request','Demande de rattachement',coalesce((select prenom from public.profiles where id=v_instructor),'Moniteur')||' → '||coalesce(v_student.prenom,'Élève'),jsonb_build_object('requestId',v_request,'instructorId',v_instructor,'studentId',v_student.id),v_instructor);
  return jsonb_build_object('state','pending','requestId',v_request,'studentId',v_student.id,'studentName',v_student.prenom);
end $$;

create or replace function public.admin_review_instructor_link_request(p_request_id uuid,p_decision text,p_note text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_req public.instructor_link_requests%rowtype; v_assignment uuid; v_payment uuid; v_rate numeric; v_amount integer;
begin
  if not public.is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'Invalid decision' using errcode='22023'; end if;
  select * into v_req from public.instructor_link_requests where id=p_request_id and status='pending' for update;
  if not found then return false; end if;
  update public.instructor_link_requests set status=p_decision,reviewed_at=now(),reviewed_by=auth.uid(),admin_note=nullif(btrim(p_note),'') where id=p_request_id;
  if p_decision='approved' then
    update public.instructor_assignments set status='ended',ended_at=now() where student_id=v_req.student_id and status='active';
    insert into public.instructor_assignments(instructor_id,student_id,status,created_by,approved_at,approved_by) values(v_req.instructor_id,v_req.student_id,'active',auth.uid(),now(),auth.uid()) returning id into v_assignment;
    update public.profiles set driving_school_id=v_req.driving_school_id where id=v_req.student_id and driving_school_id is null;
    select id into v_payment from public.platform_payments where user_id=v_req.student_id and status='succeeded' order by confirmed_at desc nulls last limit 1;
    if v_payment is not null and not exists(select 1 from public.school_commissions where payment_id=v_payment) then
      select commission_rate into v_rate from public.driving_schools where id=v_req.driving_school_id;
      select round(amount*(v_rate/100.0))::integer into v_amount from public.platform_payments where id=v_payment;
      insert into public.school_commissions(payment_id,driving_school_id,commission_rate,amount,period_start,period_end)
      select v_payment,v_req.driving_school_id,v_rate,v_amount,date_trunc('week',confirmed_at)::date,(date_trunc('week',confirmed_at)::date+6) from public.platform_payments where id=v_payment;
    end if;
    perform public.notify_user(v_req.instructor_id,'instructor.link_approved','Nouvel élève rattaché',(select prenom from public.profiles where id=v_req.student_id),jsonb_build_object('assignmentId',v_assignment,'studentId',v_req.student_id),auth.uid());
    perform public.notify_user(v_req.student_id,'student.instructor_linked','Moniteur rattaché',(select prenom from public.profiles where id=v_req.instructor_id),jsonb_build_object('assignmentId',v_assignment,'instructorId',v_req.instructor_id),auth.uid());
  else
    perform public.notify_user(v_req.instructor_id,'instructor.link_rejected','Demande de rattachement refusée',coalesce(p_note,'La demande a été refusée.'),jsonb_build_object('requestId',p_request_id),auth.uid());
  end if;
  return true;
end $$;

create or replace function public.instructor_set_readiness(p_assignment_id uuid,p_status text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_student uuid;
begin
  if p_status not in ('training','preparing','ready','needs_work') then raise exception 'Invalid readiness status' using errcode='22023'; end if;
  update public.instructor_assignments a set readiness_status=p_status where a.id=p_assignment_id and a.status='active' and (a.instructor_id=auth.uid() or public.is_admin()) returning student_id into v_student;
  if v_student is null then return false; end if;
  perform public.notify_user(v_student,'student.readiness','Statut de préparation mis à jour',case p_status when 'ready' then 'Votre moniteur vous considère prêt pour l’examen.' when 'preparing' then 'Vous êtes maintenant en préparation examen.' when 'needs_work' then 'Votre moniteur recommande encore du travail ciblé.' else 'Votre statut est En formation.' end,jsonb_build_object('status',p_status,'assignmentId',p_assignment_id),auth.uid());
  if p_status='ready' then perform public.notify_admins('student.ready','Élève prêt pour l’examen',(select prenom from public.profiles where id=v_student),jsonb_build_object('studentId',v_student,'assignmentId',p_assignment_id),auth.uid()); end if;
  return true;
end $$;

create or replace function public.instructor_send_message(p_assignment_id uuid,p_kind text,p_body text default null,p_media_path text default null,p_mime_type text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_other uuid;
begin
  if p_kind not in ('text','audio','image','video','document') then raise exception 'Invalid message kind' using errcode='22023'; end if;
  if nullif(btrim(coalesce(p_body,'')),'') is null and nullif(btrim(coalesce(p_media_path,'')),'') is null then raise exception 'Message empty' using errcode='22023'; end if;
  select case when instructor_id=auth.uid() then student_id else instructor_id end into v_other from public.instructor_assignments where id=p_assignment_id and status='active' and (instructor_id=auth.uid() or student_id=auth.uid());
  if v_other is null then raise exception 'Assignment denied' using errcode='42501'; end if;
  insert into public.instructor_messages(assignment_id,sender_id,message_kind,body,media_path,mime_type) values(p_assignment_id,auth.uid(),p_kind,nullif(btrim(p_body),''),nullif(btrim(p_media_path),''),nullif(btrim(p_mime_type),'')) returning id into v_id;
  perform public.notify_user(v_other,'message.new','Nouveau message',case when p_kind='text' then left(coalesce(p_body,''),160) else 'Nouveau '||p_kind end,jsonb_build_object('assignmentId',p_assignment_id,'messageId',v_id),auth.uid());
  return v_id;
end $$;

create or replace function public.mark_assignment_messages_read(p_assignment_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
  if not exists(select 1 from public.instructor_assignments where id=p_assignment_id and status='active' and (instructor_id=auth.uid() or student_id=auth.uid())) then raise exception 'Assignment denied' using errcode='42501'; end if;
  update public.instructor_messages set seen_at=coalesce(seen_at,now()) where assignment_id=p_assignment_id and sender_id<>auth.uid() and seen_at is null;
  get diagnostics v_count=row_count; return v_count;
end $$;

create or replace function public.instructor_create_recommendation(p_assignment_id uuid,p_type text,p_title text,p_target_key text default null,p_note text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_student uuid;
begin
  if p_type not in ('lesson','test','video') then raise exception 'Invalid recommendation type' using errcode='22023'; end if;
  select student_id into v_student from public.instructor_assignments where id=p_assignment_id and status='active' and (instructor_id=auth.uid() or public.is_admin());
  if v_student is null then raise exception 'Assignment denied' using errcode='42501'; end if;
  insert into public.instructor_recommendations(assignment_id,created_by,recommendation_type,target_key,title,note) values(p_assignment_id,auth.uid(),p_type,nullif(btrim(p_target_key),''),btrim(p_title),nullif(btrim(p_note),'')) returning id into v_id;
  perform public.notify_user(v_student,'recommendation.new','Votre moniteur vous recommande',p_title,jsonb_build_object('recommendationId',v_id,'type',p_type,'targetKey',p_target_key),auth.uid());
  return v_id;
end $$;

create or replace function public.instructor_schedule_exam(p_assignment_id uuid,p_exam_type text,p_scheduled_at timestamptz,p_location text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_student uuid;
begin
  if p_exam_type not in ('code_theory','code_oral','driving') then raise exception 'Invalid exam type' using errcode='22023'; end if;
  select student_id into v_student from public.instructor_assignments where id=p_assignment_id and status='active' and (instructor_id=auth.uid() or public.is_admin());
  if v_student is null then raise exception 'Assignment denied' using errcode='42501'; end if;
  insert into public.student_exams(assignment_id,exam_type,scheduled_at,location,created_by) values(p_assignment_id,p_exam_type,p_scheduled_at,nullif(btrim(p_location),''),auth.uid()) returning id into v_id;
  perform public.notify_user(v_student,'exam.scheduled','Examen programmé',case p_exam_type when 'driving' then 'Examen conduite' when 'code_oral' then 'Examen Code · Oral' else 'Examen Code · Théorie' end,jsonb_build_object('examId',v_id,'scheduledAt',p_scheduled_at,'location',p_location),auth.uid());
  return v_id;
end $$;

create or replace function public.instructor_update_exam_result(p_exam_id uuid,p_status text,p_observation text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_student uuid; v_assignment uuid;
begin
  if p_status not in ('scheduled','passed','failed','cancelled') then raise exception 'Invalid exam status' using errcode='22023'; end if;
  update public.student_exams e set status=p_status,observation=nullif(btrim(p_observation),''),updated_at=now() where e.id=p_exam_id and exists(select 1 from public.instructor_assignments a where a.id=e.assignment_id and (a.instructor_id=auth.uid() or public.is_admin())) returning e.assignment_id into v_assignment;
  if v_assignment is null then return false; end if;
  select student_id into v_student from public.instructor_assignments where id=v_assignment;
  perform public.notify_user(v_student,'exam.result','Résultat d’examen',case p_status when 'passed' then 'Examen réussi.' when 'failed' then 'Examen non réussi.' when 'cancelled' then 'Examen annulé.' else 'Examen reprogrammé.' end,jsonb_build_object('examId',p_exam_id,'status',p_status,'observation',p_observation),auth.uid());
  return true;
end $$;

create or replace function public.instructor_add_driving_evaluation(p_assignment_id uuid,p_session_id uuid,p_duration integer,p_location text,p_ratings jsonb,p_score numeric,p_comment text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_student uuid;
begin
  select student_id into v_student from public.instructor_assignments where id=p_assignment_id and status='active' and (instructor_id=auth.uid() or public.is_admin());
  if v_student is null then raise exception 'Assignment denied' using errcode='42501'; end if;
  insert into public.driving_evaluations(assignment_id,session_id,duration_minutes,location,ratings,overall_score,comment,created_by) values(p_assignment_id,p_session_id,p_duration,nullif(btrim(p_location),''),coalesce(p_ratings,'{}'::jsonb),p_score,nullif(btrim(p_comment),''),auth.uid()) returning id into v_id;
  perform public.notify_user(v_student,'driving.evaluation','Nouvelle évaluation de conduite','Votre moniteur a ajouté une évaluation.',jsonb_build_object('evaluationId',v_id,'score',p_score),auth.uid());
  return v_id;
end $$;

create or replace function public.get_instructor_dashboard()
returns jsonb language sql stable security definer set search_path='' as $$
with mine as (
  select a.*,p.prenom,p.telephone,exists(select 1 from public.user_presence up where up.user_id=a.student_id and up.last_seen_at>now()-interval '90 seconds') as online
  from public.instructor_assignments a join public.profiles p on p.id=a.student_id
  where a.status='active' and (a.instructor_id=auth.uid() or public.is_admin())
), stats as (select count(*)::int total,count(*) filter(where readiness_status='ready')::int ready,count(*) filter(where readiness_status='needs_work')::int difficulty from mine)
select jsonb_build_object(
 'students',(select coalesce(jsonb_agg(jsonb_build_object('assignmentId',id,'studentId',student_id,'prenom',prenom,'telephone',telephone,'online',online,'readinessStatus',readiness_status) order by prenom),'[]'::jsonb) from mine),
 'stats',(select jsonb_build_object('total',total,'ready',ready,'difficulty',difficulty,'active',greatest(total-difficulty,0)) from stats),
 'upcomingSessions',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'assignmentId',s.assignment_id,'scheduledAt',s.scheduled_at,'location',s.location,'type',s.session_type,'studentName',m.prenom) order by s.scheduled_at),'[]'::jsonb) from public.driving_sessions s join mine m on m.id=s.assignment_id where s.status='planned' and s.scheduled_at>=now() and s.scheduled_at<now()+interval '14 days'),
 'upcomingExams',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'assignmentId',e.assignment_id,'scheduledAt',e.scheduled_at,'location',e.location,'type',e.exam_type,'studentName',m.prenom) order by e.scheduled_at),'[]'::jsonb) from public.student_exams e join mine m on m.id=e.assignment_id where e.status='scheduled' and e.scheduled_at>=now()),
 'unreadNotifications',(select count(*)::int from public.app_notifications where recipient_id=auth.uid() and read_at is null)
);
$$;

create or replace function public.get_student_instructor_portal()
returns jsonb language sql stable security definer set search_path='' as $$
with a as (
 select ia.*,p.prenom instructor_name,p.telephone instructor_phone,p.photo_url instructor_photo,exists(select 1 from public.user_presence up where up.user_id=ia.instructor_id and up.last_seen_at>now()-interval '90 seconds') instructor_online
 from public.instructor_assignments ia join public.profiles p on p.id=ia.instructor_id where ia.student_id=auth.uid() and ia.status='active' limit 1
)
select case when not exists(select 1 from a) then null else jsonb_build_object(
 'assignmentId',(select id from a),'readinessStatus',(select readiness_status from a),
 'instructor',(select jsonb_build_object('id',instructor_id,'name',instructor_name,'phone',instructor_phone,'photoUrl',instructor_photo,'online',instructor_online) from a),
 'sessions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'scheduledAt',s.scheduled_at,'durationMinutes',s.duration_minutes,'location',s.location,'type',s.session_type,'theme',s.theme,'status',s.status) order by s.scheduled_at desc) from public.driving_sessions s where s.assignment_id=(select id from a) and s.scheduled_at>now()-interval '30 days'),'[]'::jsonb),
 'exams',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'type',e.exam_type,'scheduledAt',e.scheduled_at,'location',e.location,'status',e.status,'observation',e.observation) order by e.scheduled_at desc) from public.student_exams e where e.assignment_id=(select id from a)),'[]'::jsonb),
 'recommendations',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'type',r.recommendation_type,'targetKey',r.target_key,'title',r.title,'note',r.note,'status',r.status,'createdAt',r.created_at) order by r.created_at desc) from public.instructor_recommendations r where r.assignment_id=(select id from a) and r.status='active'),'[]'::jsonb),
 'evaluations',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'date',d.evaluation_date,'durationMinutes',d.duration_minutes,'location',d.location,'ratings',d.ratings,'score',d.overall_score,'comment',d.comment) order by d.evaluation_date desc,d.created_at desc) from public.driving_evaluations d where d.assignment_id=(select id from a) limit 20),'[]'::jsonb)
) end;
$$;

create or replace function public.admin_mark_commission_paid(p_school_id uuid,p_period_start date,p_period_end date,p_reference text,p_observation text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_total integer; v_settlement uuid;
begin
  if not public.is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
  select coalesce(sum(amount),0)::integer into v_total from public.school_commissions where driving_school_id=p_school_id and status='accrued' and period_start>=p_period_start and period_end<=p_period_end;
  if v_total<=0 then raise exception 'No commission to settle' using errcode='22023'; end if;
  insert into public.commission_settlements(driving_school_id,period_start,period_end,amount,status,paid_at,payment_reference,observation,created_by) values(p_school_id,p_period_start,p_period_end,v_total,'paid',now(),nullif(btrim(p_reference),''),nullif(btrim(p_observation),''),auth.uid()) returning id into v_settlement;
  update public.school_commissions set status='settled',settlement_id=v_settlement where driving_school_id=p_school_id and status='accrued' and period_start>=p_period_start and period_end<=p_period_end;
  return v_settlement;
end $$;

create or replace function public.get_admin_commercial_dashboard()
returns jsonb language sql stable security definer set search_path='' as $$
select case when not public.is_admin() then null else jsonb_build_object(
 'revenue',(select coalesce(sum(amount),0)::int from public.platform_payments where status='succeeded'),
 'confirmedPayments',(select count(*)::int from public.platform_payments where status='succeeded'),
 'pendingPayments',(select count(*)::int from public.platform_payments where status in ('initiated','processing')),
 'failedPayments',(select count(*)::int from public.platform_payments where status in ('failed','cancelled','expired')),
 'commissionsDue',(select coalesce(sum(amount),0)::int from public.school_commissions where status='accrued'),
 'commissionsPaid',(select coalesce(sum(amount),0)::int from public.school_commissions where status='settled'),
 'pendingLinkRequests',(select count(*)::int from public.instructor_link_requests where status='pending'),
 'unreadNotifications',(select count(*)::int from public.app_notifications where recipient_id=auth.uid() and read_at is null)
) end;
$$;

create or replace function public.process_wave_payment_success(p_event_id text,p_checkout_id text,p_transaction_id text,p_amount integer,p_currency text,p_payload jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_payment public.platform_payments%rowtype; v_school uuid; v_rate numeric; v_commission integer;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  if p_event_id is null or p_checkout_id is null or p_transaction_id is null then raise exception 'Missing provider identifiers' using errcode='22023'; end if;
  if exists(select 1 from public.wave_webhook_events where event_id=p_event_id) then select * into v_payment from public.platform_payments where checkout_id=p_checkout_id; return v_payment.id; end if;
  select * into v_payment from public.platform_payments where checkout_id=p_checkout_id for update;
  if not found then raise exception 'Unknown checkout' using errcode='P0002'; end if;
  if p_amount<>v_payment.amount or p_currency<>v_payment.currency then raise exception 'Payment amount mismatch' using errcode='22023'; end if;
  insert into public.wave_webhook_events(event_id,event_type,payload,result) values(p_event_id,'checkout.session.completed',coalesce(p_payload,'{}'::jsonb),'processed');
  update public.platform_payments set status='succeeded',transaction_id=p_transaction_id,provider_payload=coalesce(p_payload,'{}'::jsonb),confirmed_at=coalesce(confirmed_at,now()),updated_at=now() where id=v_payment.id returning * into v_payment;
  update public.profiles set status='active',payment_verified_at=coalesce(payment_verified_at,v_payment.confirmed_at),payment_source='wave' where id=v_payment.user_id and account_role='student';
  select driving_school_id into v_school from public.profiles where id=v_payment.user_id;
  if v_school is not null then
    update public.platform_payments set driving_school_id=v_school where id=v_payment.id and driving_school_id is null;
    if not exists(select 1 from public.school_commissions where payment_id=v_payment.id) then
      select commission_rate into v_rate from public.driving_schools where id=v_school;
      v_commission:=round(v_payment.amount*(v_rate/100.0))::integer;
      insert into public.school_commissions(payment_id,driving_school_id,commission_rate,amount,period_start,period_end) values(v_payment.id,v_school,v_rate,v_commission,date_trunc('week',v_payment.confirmed_at)::date,date_trunc('week',v_payment.confirmed_at)::date+6);
    end if;
  end if;
  perform public.notify_user(v_payment.user_id,'payment.confirmed','Paiement confirmé','Votre accès eAutoecole est maintenant actif.',jsonb_build_object('paymentId',v_payment.id,'amount',v_payment.amount,'transactionId',p_transaction_id),null);
  perform public.notify_admins('payment.confirmed','Nouvelle inscription payée',(select coalesce(prenom,'Élève') from public.profiles where id=v_payment.user_id)||' · '||v_payment.amount||' FCFA',jsonb_build_object('paymentId',v_payment.id,'userId',v_payment.user_id,'amount',v_payment.amount,'transactionId',p_transaction_id),v_payment.user_id);
  return v_payment.id;
end $$;
revoke execute on function public.process_wave_payment_success(text,text,text,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.process_wave_payment_success(text,text,text,integer,text,jsonb) to service_role;

do $$ declare sig text; begin
  foreach sig in array array[
    'touch_user_presence()','get_my_notifications(integer)','mark_notification_read(uuid)','mark_all_notifications_read()',
    'instructor_request_student_link(text)','admin_review_instructor_link_request(uuid,text,text)','instructor_set_readiness(uuid,text)',
    'instructor_send_message(uuid,text,text,text,text)','mark_assignment_messages_read(uuid)',
    'instructor_create_recommendation(uuid,text,text,text,text)','instructor_schedule_exam(uuid,text,timestamptz,text)',
    'instructor_update_exam_result(uuid,text,text)','instructor_add_driving_evaluation(uuid,uuid,integer,text,jsonb,numeric,text)',
    'get_instructor_dashboard()','get_student_instructor_portal()','admin_mark_commission_paid(uuid,date,date,text,text)','get_admin_commercial_dashboard()'
  ] loop
    execute format('revoke execute on function public.%s from public,anon',sig);
    execute format('grant execute on function public.%s to authenticated',sig);
  end loop;
end $$;

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='app_notifications') then alter publication supabase_realtime add table public.app_notifications; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='instructor_messages') then alter publication supabase_realtime add table public.instructor_messages; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='instructor_link_requests') then alter publication supabase_realtime add table public.instructor_link_requests; end if;
end $$;
