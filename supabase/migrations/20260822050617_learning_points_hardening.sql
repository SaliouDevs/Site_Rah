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
  v_parts text[];
  v_valid boolean := false;
  v_lesson integer;
  v_series text;
  v_exam text;
  v_day text := current_date::text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_kind = 'lesson' and p_points = 10 then
    v_parts := string_to_array(p_source_key, ':');
    if array_length(v_parts,1) = 2 and v_parts[1] = 'lesson' and v_parts[2] ~ '^[1-9]$' then
      v_lesson := v_parts[2]::integer;
      v_valid := exists(
        select 1 from public.learning_attempts a
        where a.user_id = auth.uid()
          and a.activity_type = 'lesson'
          and a.is_correct is true
          and coalesce((a.metadata->>'lessonId')::integer, -1) = v_lesson
      );
    end if;
  elsif p_kind = 'test' and p_points = 20 then
    v_parts := string_to_array(p_source_key, ':');
    if array_length(v_parts,1) = 3 and v_parts[1] = 'test' and v_parts[2] in ('T1','T2','T3') and v_parts[3] = v_day then
      v_series := v_parts[2];
      v_valid := exists(
        select 1 from public.learning_attempts a
        where a.user_id = auth.uid()
          and a.activity_type = 'test'
          and a.is_correct is true
          and a.created_at::date = current_date
          and a.metadata->>'seriesKey' = v_series
      );
    end if;
  elsif p_kind = 'exam' and p_points = 50 then
    v_parts := string_to_array(p_source_key, ':');
    if array_length(v_parts,1) = 4 and v_parts[1] = 'exam' and v_parts[2] in ('light','heavy') and v_parts[4] = v_day then
      v_exam := v_parts[2];
      v_series := v_parts[3];
      v_valid := exists(select 1 from public.exam_series s where s.exam_key = v_exam and s.code = v_series)
        and exists(
          select 1 from public.learning_attempts a
          where a.user_id = auth.uid()
            and a.activity_type = 'exam'
            and a.is_correct is true
            and a.created_at::date = current_date
            and a.metadata->>'exam' = v_exam
            and a.metadata->>'series' = v_series
        );
    end if;
  elsif p_kind = 'bonus' and public.is_admin() and p_points between 1 and 500 then
    v_valid := true;
  end if;

  if not v_valid then
    raise exception 'Points award not eligible' using errcode = '42501';
  end if;

  insert into public.learning_points_ledger(user_id, source_key, kind, points, metadata)
  values(auth.uid(), p_source_key, p_kind, p_points, coalesce(p_metadata, '{}'::jsonb))
  on conflict(user_id, source_key) do nothing;

  select coalesce(sum(points),0)::integer into v_total
  from public.learning_points_ledger where user_id = auth.uid();
  return v_total;
end;
$$;

revoke execute on function public.award_learning_points(text,text,integer,jsonb) from public, anon;
grant execute on function public.award_learning_points(text,text,integer,jsonb) to authenticated;
