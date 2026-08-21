-- Phase A content CMS schema.
-- This migration implements a Master/Version architecture to support:
-- 1. Simultaneous published and draft versions.
-- 2. Atomic publication (pointer swap).
-- 3. Robust history and restoration.
-- 4. Strict referential integrity (cannot delete the published version).
-- 5. Pointer Invariant: current_version_id MUST belong to the correct Master.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Generic updated_at/updated_by trigger function
CREATE OR REPLACE FUNCTION public.set_cms_updated_metadata()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  NEW.updated_by = auth.uid();
  RETURN NEW;
END;
$$;

--------------------------------------------------------------------------------
-- 1. TABLES CREATION (NO CIRCULAR FKs YET)
--------------------------------------------------------------------------------

-- EXAM SERIES
CREATE TABLE IF NOT EXISTS public.exam_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_key text NOT NULL CHECK (exam_key IN ('light', 'heavy')),
  code text NOT NULL,
  current_version_id uuid, -- Pointer to published version
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid() REFERENCES auth.users(id),
  UNIQUE (exam_key, code),
  UNIQUE (id, exam_key) -- For composite FKs from questions
);

CREATE TABLE IF NOT EXISTS public.exam_series_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id uuid NOT NULL REFERENCES public.exam_series(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  version_number integer NOT NULL DEFAULT 1,
  title text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid() REFERENCES auth.users(id),
  UNIQUE (id, series_id) -- Required for Master pointer invariant
);

-- EXAM QUESTIONS
CREATE TABLE IF NOT EXISTS public.exam_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text UNIQUE,
  exam_key text NOT NULL CHECK (exam_key IN ('light', 'heavy')),
  series_id uuid NOT NULL,
  current_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid() REFERENCES auth.users(id),
  -- Composite FK to ensure question's exam_key matches series' exam_key
  FOREIGN KEY (series_id, exam_key) REFERENCES public.exam_series(id, exam_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.exam_question_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.exam_questions(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  version_number integer NOT NULL DEFAULT 1,
  question_text text NOT NULL,
  explanation text,
  image_path text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid() REFERENCES auth.users(id),
  UNIQUE (id, question_id) -- Required for Master pointer invariant
);

CREATE TABLE IF NOT EXISTS public.exam_question_choices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_version_id uuid NOT NULL REFERENCES public.exam_question_versions(id) ON DELETE CASCADE,
  choice_key text NOT NULL,
  label text NOT NULL,
  is_correct boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid() REFERENCES auth.users(id),
  UNIQUE (question_version_id, choice_key),
  UNIQUE (question_version_id, sort_order)
);

-- LESSONS
CREATE TABLE IF NOT EXISTS public.cms_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text UNIQUE,
  current_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid() REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS public.cms_lesson_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL REFERENCES public.cms_lessons(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  version_number integer NOT NULL DEFAULT 1,
  title text NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid() REFERENCES auth.users(id),
  UNIQUE (id, lesson_id) -- Required for Master pointer invariant
);

CREATE TABLE IF NOT EXISTS public.cms_lesson_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_version_id uuid NOT NULL REFERENCES public.cms_lesson_versions(id) ON DELETE CASCADE,
  title text,
  content text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid() REFERENCES auth.users(id),
  UNIQUE (lesson_version_id, sort_order)
);

-- LESSON QUESTIONS
CREATE TABLE IF NOT EXISTS public.cms_lesson_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL REFERENCES public.cms_lessons(id) ON DELETE CASCADE,
  current_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid() REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS public.cms_lesson_question_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.cms_lesson_questions(id) ON DELETE CASCADE,
  step_id uuid, -- Optional link to a specific step
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  version_number integer NOT NULL DEFAULT 1,
  question_text text NOT NULL,
  explanation text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid() REFERENCES auth.users(id),
  UNIQUE (id, question_id) -- Required for Master pointer invariant
);

CREATE TABLE IF NOT EXISTS public.cms_lesson_question_choices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_version_id uuid NOT NULL REFERENCES public.cms_lesson_question_versions(id) ON DELETE CASCADE,
  choice_key text NOT NULL,
  label text NOT NULL,
  is_correct boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid() REFERENCES auth.users(id),
  UNIQUE (question_version_id, choice_key),
  UNIQUE (question_version_id, sort_order)
);

-- PANELS
CREATE TABLE IF NOT EXISTS public.cms_panels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text UNIQUE,
  category text NOT NULL,
  current_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid() REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS public.cms_panel_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  panel_id uuid NOT NULL REFERENCES public.cms_panels(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  version_number integer NOT NULL DEFAULT 1,
  title text NOT NULL,
  description text,
  image_path text,
  audio_fr_path text,
  audio_wo_path text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid() REFERENCES auth.users(id),
  UNIQUE (id, panel_id) -- Required for Master pointer invariant
);

-- MEDIA ASSETS
CREATE TABLE IF NOT EXISTS public.cms_media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket text NOT NULL,
  storage_path text NOT NULL,
  media_kind text NOT NULL CHECK (media_kind IN ('image', 'audio', 'other')),
  mime_type text NOT NULL,
  language text CHECK (language IN ('fr', 'wo')),
  title text,
  alt_text text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid() REFERENCES auth.users(id),
  UNIQUE (bucket, storage_path)
);

-- AUDIT / HISTORY
CREATE TABLE IF NOT EXISTS public.cms_content_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  version_number integer NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id),
  UNIQUE (entity_type, entity_id, version_number)
);

--------------------------------------------------------------------------------
-- 2. APPLY CIRCULAR FKs WITH MASTER INVARIANT
--------------------------------------------------------------------------------

-- Important: NO ACTION prevents deleting a version currently pointed by a Master.
-- Composite FKs (version_id, master_id) ensure the version BELONGS to that Master.

ALTER TABLE public.exam_series 
  ADD CONSTRAINT fk_current_version_series 
  FOREIGN KEY (current_version_id, id) 
  REFERENCES public.exam_series_versions(id, series_id) ON DELETE NO ACTION;

ALTER TABLE public.exam_questions 
  ADD CONSTRAINT fk_current_version_question 
  FOREIGN KEY (current_version_id, id) 
  REFERENCES public.exam_question_versions(id, question_id) ON DELETE NO ACTION;

ALTER TABLE public.cms_lessons 
  ADD CONSTRAINT fk_current_version_lesson 
  FOREIGN KEY (current_version_id, id) 
  REFERENCES public.cms_lesson_versions(id, lesson_id) ON DELETE NO ACTION;

ALTER TABLE public.cms_lesson_questions 
  ADD CONSTRAINT fk_current_version_lesson_question 
  FOREIGN KEY (current_version_id, id) 
  REFERENCES public.cms_lesson_question_versions(id, question_id) ON DELETE NO ACTION;

ALTER TABLE public.cms_panels 
  ADD CONSTRAINT fk_current_version_panel 
  FOREIGN KEY (current_version_id, id) 
  REFERENCES public.cms_panel_versions(id, panel_id) ON DELETE NO ACTION;

--------------------------------------------------------------------------------
-- 3. INDEXES
--------------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_exam_series_code ON public.exam_series (exam_key, code);
CREATE INDEX IF NOT EXISTS idx_exam_series_versions_status ON public.exam_series_versions (series_id, status, sort_order);
CREATE INDEX IF NOT EXISTS idx_exam_questions_legacy ON public.exam_questions (legacy_id);
CREATE INDEX IF NOT EXISTS idx_exam_questions_series ON public.exam_questions (series_id, exam_key);
CREATE INDEX IF NOT EXISTS idx_exam_question_versions_status ON public.exam_question_versions (question_id, status, sort_order);
CREATE INDEX IF NOT EXISTS idx_cms_lessons_legacy ON public.cms_lessons (legacy_id);
CREATE INDEX IF NOT EXISTS idx_cms_lesson_versions_status ON public.cms_lesson_versions (lesson_id, status, sort_order);
CREATE INDEX IF NOT EXISTS idx_cms_panels_lookup ON public.cms_panels (category, legacy_id);
CREATE INDEX IF NOT EXISTS idx_cms_panel_versions_status ON public.cms_panel_versions (panel_id, status, sort_order);
CREATE INDEX IF NOT EXISTS idx_cms_media_lookup ON public.cms_media_assets (media_kind, status, language);

--------------------------------------------------------------------------------
-- 4. TRIGGERS
--------------------------------------------------------------------------------

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'exam_series', 'exam_series_versions',
    'exam_questions', 'exam_question_versions', 'exam_question_choices',
    'cms_lessons', 'cms_lesson_versions', 'cms_lesson_steps',
    'cms_lesson_questions', 'cms_lesson_question_versions', 'cms_lesson_question_choices',
    'cms_panels', 'cms_panel_versions',
    'cms_media_assets'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_%I_metadata ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER set_%I_metadata BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_cms_updated_metadata()', t, t);
  END LOOP;
END;
$$;

--------------------------------------------------------------------------------
-- 5. RLS POLICIES
--------------------------------------------------------------------------------

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'exam_series', 'exam_series_versions',
    'exam_questions', 'exam_question_versions', 'exam_question_choices',
    'cms_lessons', 'cms_lesson_versions', 'cms_lesson_steps',
    'cms_lesson_questions', 'cms_lesson_question_versions', 'cms_lesson_question_choices',
    'cms_panels', 'cms_panel_versions',
    'cms_media_assets', 'cms_content_versions'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END;
$$;

-- Master tables
CREATE POLICY "exam_series_read_public" ON public.exam_series FOR SELECT TO authenticated
  USING (current_version_id IS NOT NULL OR public.is_admin());

CREATE POLICY "exam_questions_read_public" ON public.exam_questions FOR SELECT TO authenticated
  USING (current_version_id IS NOT NULL OR public.is_admin());

CREATE POLICY "cms_lessons_read_public" ON public.cms_lessons FOR SELECT TO authenticated
  USING (current_version_id IS NOT NULL OR public.is_admin());

CREATE POLICY "cms_lesson_questions_read_public" ON public.cms_lesson_questions FOR SELECT TO authenticated
  USING (current_version_id IS NOT NULL OR public.is_admin());

CREATE POLICY "cms_panels_read_public" ON public.cms_panels FOR SELECT TO authenticated
  USING (current_version_id IS NOT NULL OR public.is_admin());

-- Version tables (Student sees only IF it is the designated current version)
CREATE POLICY "exam_series_versions_read_public" ON public.exam_series_versions FOR SELECT TO authenticated
  USING (
    public.is_admin() OR 
    EXISTS (SELECT 1 FROM public.exam_series s WHERE s.current_version_id = exam_series_versions.id)
  );

CREATE POLICY "exam_question_versions_read_public" ON public.exam_question_versions FOR SELECT TO authenticated
  USING (
    public.is_admin() OR 
    EXISTS (SELECT 1 FROM public.exam_questions q WHERE q.current_version_id = exam_question_versions.id)
  );

CREATE POLICY "cms_lesson_versions_read_public" ON public.cms_lesson_versions FOR SELECT TO authenticated
  USING (
    public.is_admin() OR 
    EXISTS (SELECT 1 FROM public.cms_lessons l WHERE l.current_version_id = cms_lesson_versions.id)
  );

CREATE POLICY "cms_lesson_question_versions_read_public" ON public.cms_lesson_question_versions FOR SELECT TO authenticated
  USING (
    public.is_admin() OR 
    EXISTS (SELECT 1 FROM public.cms_lesson_questions q WHERE q.current_version_id = cms_lesson_question_versions.id)
  );

CREATE POLICY "cms_panel_versions_read_public" ON public.cms_panel_versions FOR SELECT TO authenticated
  USING (
    public.is_admin() OR 
    EXISTS (SELECT 1 FROM public.cms_panels p WHERE p.current_version_id = cms_panel_versions.id)
  );

-- Children tables (RLS checks Master current_version_id via Version link)
CREATE POLICY "exam_question_choices_read_public" ON public.exam_question_choices FOR SELECT TO authenticated
  USING (
    public.is_admin() OR 
    EXISTS (
      SELECT 1 FROM public.exam_questions q 
      WHERE q.current_version_id = exam_question_choices.question_version_id
    )
  );

CREATE POLICY "cms_lesson_steps_read_public" ON public.cms_lesson_steps FOR SELECT TO authenticated
  USING (
    public.is_admin() OR 
    EXISTS (
      SELECT 1 FROM public.cms_lessons l 
      WHERE l.current_version_id = cms_lesson_steps.lesson_version_id
    )
  );

CREATE POLICY "cms_lesson_question_choices_read_public" ON public.cms_lesson_question_choices FOR SELECT TO authenticated
  USING (
    public.is_admin() OR 
    EXISTS (
      SELECT 1 FROM public.cms_lesson_questions q 
      WHERE q.current_version_id = cms_lesson_question_choices.question_version_id
    )
  );

-- Other tables
CREATE POLICY "cms_media_assets_read_public" ON public.cms_media_assets FOR SELECT TO authenticated
  USING (status = 'published' OR public.is_admin());

CREATE POLICY "cms_content_versions_read_admin" ON public.cms_content_versions FOR SELECT TO authenticated
  USING (public.is_admin());

-- ALL Access for Admins
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'exam_series', 'exam_series_versions',
    'exam_questions', 'exam_question_versions', 'exam_question_choices',
    'cms_lessons', 'cms_lesson_versions', 'cms_lesson_steps',
    'cms_lesson_questions', 'cms_lesson_question_versions', 'cms_lesson_question_choices',
    'cms_panels', 'cms_panel_versions',
    'cms_media_assets', 'cms_content_versions'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('CREATE POLICY "admin_all_%I" ON public.%I FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())', t, t);
  END LOOP;
END;
$$;

--------------------------------------------------------------------------------
-- 6. PERMISSIONS
--------------------------------------------------------------------------------

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'exam_series', 'exam_series_versions',
    'exam_questions', 'exam_question_versions', 'exam_question_choices',
    'cms_lessons', 'cms_lesson_versions', 'cms_lesson_steps',
    'cms_lesson_questions', 'cms_lesson_question_versions', 'cms_lesson_question_choices',
    'cms_panels', 'cms_panel_versions',
    'cms_media_assets', 'cms_content_versions'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END;
$$;
