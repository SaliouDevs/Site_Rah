-- High-value FK indexes for current-version pointers and lesson relations.
create index if not exists idx_cms_lesson_question_versions_question_id
  on public.cms_lesson_question_versions(question_id);
create index if not exists idx_cms_lesson_questions_lesson_id
  on public.cms_lesson_questions(lesson_id);
create index if not exists idx_cms_lesson_questions_current_version
  on public.cms_lesson_questions(current_version_id, id);
create index if not exists idx_cms_lessons_current_version
  on public.cms_lessons(current_version_id, id);
create index if not exists idx_cms_panels_current_version
  on public.cms_panels(current_version_id, id);
create index if not exists idx_exam_questions_current_version
  on public.exam_questions(current_version_id, id);
create index if not exists idx_exam_series_current_version
  on public.exam_series(current_version_id, id);

-- Evaluate auth context once per statement rather than once per row.
drop policy if exists exam_images_admin_insert on public.exam_question_images;
create policy exam_images_admin_insert
on public.exam_question_images
for insert
to authenticated
with check ((select public.is_admin()) and updated_by = (select auth.uid()));

drop policy if exists exam_images_admin_update on public.exam_question_images;
create policy exam_images_admin_update
on public.exam_question_images
for update
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()) and updated_by = (select auth.uid()));

drop policy if exists exam_settings_admin_update on public.exam_settings;
create policy exam_settings_admin_update
on public.exam_settings
for update
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()) and updated_by = (select auth.uid()));
