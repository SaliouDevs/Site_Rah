-- V3.3.1 platform integrity + learning foundation
-- Single active student device, safe admin deletes, version cleanup,
-- learning analytics, onboarding state and non-farmable point ledger.

create table if not exists public.user_active_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  device_id text not null,
  session_token uuid not null default gen_random_uuid(),
  claimed_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.user_active_sessions enable row level security;

drop policy if exists "active_session_read_own" on public.user_active_sessions;
create policy "active_session_read_own"
on public.user_active_sessions for select
to authenticated
using (user_id = (select auth.uid()) or public.is_admin());

revoke insert, update, delete on public.user_active_sessions from anon, authenticated;
grant select on public.user_active_sessions to authenticated;

create table if not exists public.student_learning_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  onboarding_completed boolean not null default false,
  preferred_license text not null default 'light' check (preferred_license in ('light','heavy','both')),
  learning_goal text,
  updated_at timestamptz not null default now()
);

alter table public.student_learning_profiles enable row level security;

drop policy if exists "learning_profile_read_own" on public.student_learning_profiles;
create policy "learning_profile_read_own"
on public.student_learning_profiles for select
to authenticated
using (user_id = (select auth.uid()) or public.is_admin());

drop policy if exists "learning_profile_insert_own" on public.student_learning_profiles;
create policy "learning_profile_insert_own"
on public.student_learning_profiles for insert
to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "learning_profile_update_own" on public.student_learning_profiles;
create policy "learning_profile_update_own"
on public.student_learning_profiles for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create table if not exists public.learning_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_type text not null check (activity_type in ('lesson','test','exam','daily','speed','situation','review')),
  activity_key text not null,
  question_id text,
  topic text,
  is_correct boolean,
  score numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_learning_attempts_user_created
  on public.learning_attempts(user_id, created_at desc);
create index if not exists idx_learning_attempts_user_topic
  on public.learning_attempts(user_id, topic) where topic is not null;

alter table public.learning_attempts enable row level security;

drop policy if exists "learning_attempts_read_own" on public.learning_attempts;
create policy "learning_attempts_read_own"
on public.learning_attempts for select
to authenticated
using (user_id = (select auth.uid()) or public.is_admin());

revoke insert, update, delete on public.learning_attempts from anon, authenticated;
grant select on public.learning_attempts to authenticated;

create table if not exists public.learning_points_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_key text not null,
  kind text not null check (kind in ('lesson','test','exam','bonus')),
  points integer not null check (points > 0 and points <= 500),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(user_id, source_key)
);

create index if not exists idx_learning_points_user_created
  on public.learning_points_ledger(user_id, created_at desc);

alter table public.learning_points_ledger enable row level security;

drop policy if exists "learning_points_read_own" on public.learning_points_ledger;
create policy "learning_points_read_own"
on public.learning_points_ledger for select
to authenticated
using (user_id = (select auth.uid()) or public.is_admin());

revoke insert, update, delete on public.learning_points_ledger from anon, authenticated;
grant select on public.learning_points_ledger to authenticated;

create or replace function public.claim_user_session(p_device_id text)
returns table(device_id text, session_token uuid, claimed_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.user_active_sessions%rowtype;
  v_token uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if nullif(btrim(p_device_id), '') is null or length(p_device_id) > 160 then
    raise exception 'Invalid device id' using errcode = '22023';
  end if;

  select * into v_existing
  from public.user_active_sessions s
  where s.user_id = v_user_id
  for update;

  if found and v_existing.device_id = p_device_id then
    update public.user_active_sessions
       set last_seen_at = now()
     where user_id = v_user_id;
    return query
      select s.device_id, s.session_token, s.claimed_at
      from public.user_active_sessions s where s.user_id = v_user_id;
    return;
  end if;

  v_token := gen_random_uuid();
  insert into public.user_active_sessions(user_id, device_id, session_token, claimed_at, last_seen_at)
  values(v_user_id, p_device_id, v_token, now(), now())
  on conflict(user_id) do update
    set device_id = excluded.device_id,
        session_token = excluded.session_token,
        claimed_at = excluded.claimed_at,
        last_seen_at = excluded.last_seen_at;

  return query
    select s.device_id, s.session_token, s.claimed_at
    from public.user_active_sessions s where s.user_id = v_user_id;
end;
$$;

create or replace function public.validate_user_session(p_device_id text, p_session_token uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists(
    select 1 from public.user_active_sessions s
    where s.user_id = auth.uid()
      and s.device_id = p_device_id
      and s.session_token = p_session_token
  );
$$;

create or replace function public.touch_user_session(p_device_id text, p_session_token uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.user_active_sessions
     set last_seen_at = now()
   where user_id = auth.uid()
     and device_id = p_device_id
     and session_token = p_session_token;
  return found;
end;
$$;

create or replace function public.release_user_session(p_device_id text, p_session_token uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.user_active_sessions
   where user_id = auth.uid()
     and device_id = p_device_id
     and session_token = p_session_token;
  return found;
end;
$$;

create or replace function public.record_learning_attempt(
  p_activity_type text,
  p_activity_key text,
  p_question_id text default null,
  p_topic text default null,
  p_is_correct boolean default null,
  p_score numeric default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_activity_type not in ('lesson','test','exam','daily','speed','situation','review') then
    raise exception 'Invalid activity type' using errcode = '22023';
  end if;
  if nullif(btrim(p_activity_key), '') is null then
    raise exception 'Activity key required' using errcode = '22023';
  end if;

  insert into public.learning_attempts(
    user_id, activity_type, activity_key, question_id, topic,
    is_correct, score, metadata
  ) values (
    auth.uid(), p_activity_type, p_activity_key,
    nullif(p_question_id, ''), nullif(p_topic, ''),
    p_is_correct, p_score, coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.award_learning_points(
  p_source_key text,
  p_kind text,
  p_points integer,
  p_metadata jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_kind not in ('lesson','test','exam','bonus') then
    raise exception 'Invalid points kind' using errcode = '22023';
  end if;
  if p_points <= 0 or p_points > 500 then
    raise exception 'Invalid points value' using errcode = '22023';
  end if;

  insert into public.learning_points_ledger(user_id, source_key, kind, points, metadata)
  values(auth.uid(), p_source_key, p_kind, p_points, coalesce(p_metadata, '{}'::jsonb))
  on conflict(user_id, source_key) do nothing;

  select coalesce(sum(points),0)::integer into v_total
  from public.learning_points_ledger
  where user_id = auth.uid();
  return v_total;
end;
$$;

create or replace function public.get_learning_dashboard()
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  with my_attempts as (
    select * from public.learning_attempts where user_id = auth.uid()
  ), topic_stats as (
    select topic,
           count(*)::int as attempts,
           count(*) filter(where is_correct is true)::int as correct,
           round(100.0 * count(*) filter(where is_correct is true) / nullif(count(*) filter(where is_correct is not null),0))::int as accuracy
      from my_attempts
     where topic is not null and is_correct is not null
     group by topic
  )
  select jsonb_build_object(
    'points', (select coalesce(sum(points),0)::int from public.learning_points_ledger where user_id = auth.uid()),
    'attempts', (select count(*)::int from my_attempts),
    'answered', (select count(*)::int from my_attempts where is_correct is not null),
    'correct', (select count(*)::int from my_attempts where is_correct is true),
    'weakTopics', coalesce((
      select jsonb_agg(jsonb_build_object('topic',topic,'attempts',attempts,'correct',correct,'accuracy',coalesce(accuracy,0)) order by coalesce(accuracy,0), attempts desc)
      from (select * from topic_stats where attempts >= 2 limit 6) s
    ), '[]'::jsonb)
  );
$$;

create or replace function public.admin_delete_user(target_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can delete users' using errcode = '42501';
  end if;
  if target_user_id is null or target_user_id = auth.uid() then
    raise exception 'Cannot delete this account' using errcode = '42501';
  end if;

  select coalesce(raw_app_meta_data->>'role','') into v_role
  from auth.users where id = target_user_id;
  if not found then return false; end if;
  if v_role = 'admin' then
    raise exception 'Admin accounts cannot be deleted here' using errcode = '42501';
  end if;

  delete from auth.users where id = target_user_id;
  return found;
end;
$$;

create or replace function public.admin_delete_exam_question_version(
  p_question_id uuid,
  p_version_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current uuid;
  v_version public.exam_question_versions%rowtype;
  v_snapshot jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only admins can delete versions' using errcode = '42501';
  end if;

  select current_version_id into v_current
  from public.exam_questions
  where id = p_question_id
  for update;
  if not found then
    raise exception 'Question not found' using errcode = '22P02';
  end if;
  if v_current = p_version_id then
    raise exception 'The active published version cannot be deleted' using errcode = '42501';
  end if;

  select * into v_version
  from public.exam_question_versions
  where id = p_version_id and question_id = p_question_id
  for update;
  if not found then return false; end if;

  select jsonb_build_object(
    'version', to_jsonb(v_version),
    'choices', coalesce((select jsonb_agg(to_jsonb(c) order by c.sort_order) from public.exam_question_choices c where c.question_version_id = p_version_id), '[]'::jsonb)
  ) into v_snapshot;

  insert into public.cms_content_versions(entity_type, entity_id, version_number, snapshot, created_by)
  values('exam_question_version_deleted', p_question_id, v_version.version_number, v_snapshot, auth.uid());

  delete from public.exam_question_versions where id = p_version_id;
  return found;
end;
$$;

revoke execute on function public.claim_user_session(text) from public, anon;
revoke execute on function public.validate_user_session(text, uuid) from public, anon;
revoke execute on function public.touch_user_session(text, uuid) from public, anon;
revoke execute on function public.release_user_session(text, uuid) from public, anon;
revoke execute on function public.record_learning_attempt(text,text,text,text,boolean,numeric,jsonb) from public, anon;
revoke execute on function public.award_learning_points(text,text,integer,jsonb) from public, anon;
revoke execute on function public.get_learning_dashboard() from public, anon;
revoke execute on function public.admin_delete_user(uuid) from public, anon;
revoke execute on function public.admin_delete_exam_question_version(uuid,uuid) from public, anon;

grant execute on function public.claim_user_session(text) to authenticated;
grant execute on function public.validate_user_session(text, uuid) to authenticated;
grant execute on function public.touch_user_session(text, uuid) to authenticated;
grant execute on function public.release_user_session(text, uuid) to authenticated;
grant execute on function public.record_learning_attempt(text,text,text,text,boolean,numeric,jsonb) to authenticated;
grant execute on function public.award_learning_points(text,text,integer,jsonb) to authenticated;
grant execute on function public.get_learning_dashboard() to authenticated;
grant execute on function public.admin_delete_user(uuid) to authenticated;
grant execute on function public.admin_delete_exam_question_version(uuid,uuid) to authenticated;

-- Realtime makes a replaced device notice the new claim immediately.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_active_sessions'
  ) then
    alter publication supabase_realtime add table public.user_active_sessions;
  end if;
end $$;
