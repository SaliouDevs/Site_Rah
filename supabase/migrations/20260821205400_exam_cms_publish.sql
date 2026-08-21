-- Phase B: CMS Publishing and Draft Operations
-- This migration adds RPCs for question/series editing workflow:
-- 1. create_exam_question_draft() — Create draft from published version
-- 2. publish_exam_question_version() — Publish a draft version
-- 3. restore_exam_question_version_as_draft() — Create draft from archived version

-- Constraint: Only ONE editable (draft) version per question at a time
-- This ensures clean workflow without multiple draft conflicts.

ALTER TABLE public.exam_question_versions
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS idx_exam_question_versions_one_active_draft
ON public.exam_question_versions (question_id)
WHERE status = 'draft';

CREATE UNIQUE INDEX IF NOT EXISTS idx_exam_series_versions_one_active_draft
ON public.exam_series_versions (series_id)
WHERE status = 'draft';

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'exam_series', 'exam_series_versions',
    'exam_questions', 'exam_question_versions', 'exam_question_choices'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_%I_metadata ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER set_%I_metadata BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_cms_updated_metadata()', t, t);
  END LOOP;
END;
$$;

-- ============================================================================
-- 1. DRAFT CREATION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_exam_question_draft(p_question_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing_draft_id uuid;
  v_current_version_id uuid;
  v_new_version_id uuid;
  v_new_version_number integer;
  v_choice_ids uuid[];
BEGIN
  -- ADMIN ONLY
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can create drafts' USING ERRCODE = '42501';
  END IF;

  -- Validate question exists
  SELECT current_version_id INTO v_current_version_id
  FROM public.exam_questions
  WHERE id = p_question_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Question not found' USING ERRCODE = '22P02';
  END IF;

  -- Check if draft already exists
  SELECT id INTO v_existing_draft_id
  FROM public.exam_question_versions
  WHERE question_id = p_question_id
    AND status = 'draft'
  LIMIT 1;

  IF v_existing_draft_id IS NOT NULL THEN
    -- Draft exists; return it (idempotent)
    RETURN v_existing_draft_id;
  END IF;

  -- Create new draft version from current published version
  IF v_current_version_id IS NOT NULL THEN
    -- Copy from published version
    SELECT version_number INTO v_new_version_number
    FROM public.exam_question_versions
    WHERE id = v_current_version_id;

    v_new_version_number := v_new_version_number + 1;

    v_new_version_id := gen_random_uuid();

    INSERT INTO public.exam_question_versions (
      id, question_id, status, version_number,
      question_text, explanation, image_path, sort_order, metadata,
      created_at, updated_at, updated_by
    )
    SELECT
      v_new_version_id, p_question_id, 'draft', v_new_version_number,
      question_text, explanation, image_path, sort_order, metadata,
      now(), now(), auth.uid()
    FROM public.exam_question_versions
    WHERE id = v_current_version_id;

    -- Copy choices from published version
    INSERT INTO public.exam_question_choices (
      id, question_version_id, choice_key, label, is_correct, sort_order,
      created_at, updated_at, updated_by
    )
    SELECT
      gen_random_uuid(), v_new_version_id, choice_key, label, is_correct, sort_order,
      now(), now(), auth.uid()
    FROM public.exam_question_choices
    WHERE question_version_id = v_current_version_id;

  ELSE
    -- No published version; create blank draft
    v_new_version_id := gen_random_uuid();

    INSERT INTO public.exam_question_versions (
      id, question_id, status, version_number,
      question_text, explanation, image_path, sort_order, metadata,
      created_at, updated_at, updated_by
    )
    VALUES (
      v_new_version_id, p_question_id, 'draft', 1,
      '', NULL, NULL, 0, '{}'::jsonb,
      now(), now(), auth.uid()
    );
  END IF;

  RETURN v_new_version_id;
END;
$$;

-- ============================================================================
-- 2. DRAFT PUBLICATION (ATOMIC)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.publish_exam_question_version(
  p_question_id uuid,
  p_version_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_version_status text;
  v_version_question_id uuid;
  v_old_version_id uuid;
BEGIN
  -- ADMIN ONLY
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can publish' USING ERRCODE = '42501';
  END IF;

  -- Validate question exists
  IF NOT EXISTS (SELECT 1 FROM public.exam_questions WHERE id = p_question_id) THEN
    RAISE EXCEPTION 'Question not found' USING ERRCODE = '22P02';
  END IF;

  PERFORM 1
  FROM public.exam_questions
  WHERE id = p_question_id
  FOR UPDATE;

  -- Validate version exists and belongs to this question
  SELECT status, question_id INTO v_version_status, v_version_question_id
  FROM public.exam_question_versions
  WHERE id = p_version_id
    AND question_id = p_question_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Version not found' USING ERRCODE = '22P02';
  END IF;

  IF v_version_question_id != p_question_id THEN
    RAISE EXCEPTION 'Version does not belong to this question' USING ERRCODE = '23503';
  END IF;

  -- Validate version is a draft
  IF v_version_status != 'draft' THEN
    RAISE EXCEPTION 'Only draft versions can be published' USING ERRCODE = '42P04';
  END IF;

  -- ATOMIC: Update version status to published
  UPDATE public.exam_question_versions
  SET status = 'published', updated_at = now(), updated_by = auth.uid()
  WHERE id = p_version_id;

  -- ATOMIC: Get old published version (if any)
  SELECT current_version_id INTO v_old_version_id
  FROM public.exam_questions
  WHERE id = p_question_id
  FOR UPDATE;

  -- ATOMIC: Archive old published version
  IF v_old_version_id IS NOT NULL AND v_old_version_id != p_version_id THEN
    UPDATE public.exam_question_versions
    SET status = 'archived', updated_at = now(), updated_by = auth.uid()
    WHERE id = v_old_version_id;
  END IF;

  -- ATOMIC: Pointer swap (current_version_id = new draft)
  UPDATE public.exam_questions
  SET current_version_id = p_version_id, updated_at = now(), updated_by = auth.uid()
  WHERE id = p_question_id;

  RETURN true;
END;
$$;

-- ============================================================================
-- 3. RESTORE ARCHIVED VERSION AS NEW DRAFT
-- ============================================================================

CREATE OR REPLACE FUNCTION public.restore_exam_question_version_as_draft(
  p_question_id uuid,
  p_source_version_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source_status text;
  v_source_question_id uuid;
  v_new_version_id uuid;
  v_new_version_number integer;
  v_current_version_number integer;
BEGIN
  -- ADMIN ONLY
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can restore versions' USING ERRCODE = '42501';
  END IF;

  -- Validate question exists
  IF NOT EXISTS (SELECT 1 FROM public.exam_questions WHERE id = p_question_id) THEN
    RAISE EXCEPTION 'Question not found' USING ERRCODE = '22P02';
  END IF;

  -- Validate source version exists and belongs to this question
  SELECT status, question_id, version_number
  INTO v_source_status, v_source_question_id, v_new_version_number
  FROM public.exam_question_versions
  WHERE id = p_source_version_id
    AND question_id = p_question_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source version not found' USING ERRCODE = '22P02';
  END IF;

  IF v_source_question_id != p_question_id THEN
    RAISE EXCEPTION 'Source version does not belong to this question' USING ERRCODE = '23503';
  END IF;

  -- Get current max version number to generate next one
  SELECT MAX(version_number) INTO v_current_version_number
  FROM public.exam_question_versions
  WHERE question_id = p_question_id;

  v_new_version_number := COALESCE(v_current_version_number, 0) + 1;

  -- Create NEW draft (copy of source, not reuse old version ID)
  v_new_version_id := gen_random_uuid();

  INSERT INTO public.exam_question_versions (
    id, question_id, status, version_number,
    question_text, explanation, image_path, sort_order, metadata,
    created_at, updated_at, updated_by
  )
  SELECT
    v_new_version_id, p_question_id, 'draft', v_new_version_number,
    question_text, explanation, image_path, sort_order, metadata,
    now(), now(), auth.uid()
  FROM public.exam_question_versions
  WHERE id = p_source_version_id;

  -- Copy choices
  INSERT INTO public.exam_question_choices (
    id, question_version_id, choice_key, label, is_correct, sort_order,
    created_at, updated_at, updated_by
  )
  SELECT
    gen_random_uuid(), v_new_version_id, choice_key, label, is_correct, sort_order,
    now(), now(), auth.uid()
  FROM public.exam_question_choices
  WHERE question_version_id = p_source_version_id;

  -- Note: We do NOT update current_version_id here.
  -- Admin must explicitly publish() this draft if they want it live.

  RETURN v_new_version_id;
END;
$$;

-- ============================================================================
-- 4. SERIES DRAFT OPERATIONS (Similar to questions)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_exam_series_draft(p_series_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing_draft_id uuid;
  v_current_version_id uuid;
  v_new_version_id uuid;
  v_new_version_number integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can create drafts' USING ERRCODE = '42501';
  END IF;

  SELECT current_version_id INTO v_current_version_id
  FROM public.exam_series
  WHERE id = p_series_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Series not found' USING ERRCODE = '22P02';
  END IF;

  SELECT id INTO v_existing_draft_id
  FROM public.exam_series_versions
  WHERE series_id = p_series_id
    AND status = 'draft'
  LIMIT 1;

  IF v_existing_draft_id IS NOT NULL THEN
    RETURN v_existing_draft_id;
  END IF;

  IF v_current_version_id IS NOT NULL THEN
    SELECT version_number INTO v_new_version_number
    FROM public.exam_series_versions
    WHERE id = v_current_version_id;

    v_new_version_number := v_new_version_number + 1;
    v_new_version_id := gen_random_uuid();

    INSERT INTO public.exam_series_versions (
      id, series_id, status, version_number,
      title, sort_order,
      created_at, updated_at, updated_by
    )
    SELECT
      v_new_version_id, p_series_id, 'draft', v_new_version_number,
      title, sort_order,
      now(), now(), auth.uid()
    FROM public.exam_series_versions
    WHERE id = v_current_version_id;
  ELSE
    v_new_version_id := gen_random_uuid();
    INSERT INTO public.exam_series_versions (
      id, series_id, status, version_number,
      title, sort_order,
      created_at, updated_at, updated_by
    )
    VALUES (
      v_new_version_id, p_series_id, 'draft', 1,
      '', 0,
      now(), now(), auth.uid()
    );
  END IF;

  RETURN v_new_version_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_exam_series_version(
  p_series_id uuid,
  p_version_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_version_status text;
  v_version_series_id uuid;
  v_old_version_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can publish' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.exam_series WHERE id = p_series_id) THEN
    RAISE EXCEPTION 'Series not found' USING ERRCODE = '22P02';
  END IF;

  SELECT status, series_id INTO v_version_status, v_version_series_id
  FROM public.exam_series_versions
  WHERE id = p_version_id
    AND series_id = p_series_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Version not found' USING ERRCODE = '22P02';
  END IF;

  IF v_version_series_id != p_series_id THEN
    RAISE EXCEPTION 'Version does not belong to this series' USING ERRCODE = '23503';
  END IF;

  IF v_version_status != 'draft' THEN
    RAISE EXCEPTION 'Only draft versions can be published' USING ERRCODE = '42P04';
  END IF;

  UPDATE public.exam_series_versions
  SET status = 'published', updated_at = now(), updated_by = auth.uid()
  WHERE id = p_version_id;

  SELECT current_version_id INTO v_old_version_id
  FROM public.exam_series
  WHERE id = p_series_id
  FOR UPDATE;

  IF v_old_version_id IS NOT NULL AND v_old_version_id != p_version_id THEN
    UPDATE public.exam_series_versions
    SET status = 'archived', updated_at = now(), updated_by = auth.uid()
    WHERE id = v_old_version_id;
  END IF;

  UPDATE public.exam_series
  SET current_version_id = p_version_id, updated_at = now(), updated_by = auth.uid()
  WHERE id = p_series_id;

  RETURN true;
END;
$$;

-- ============================================================================
-- 5. ATOMIC DRAFT SAVE
-- ============================================================================

CREATE OR REPLACE FUNCTION public.save_exam_question_draft(
  p_question_id uuid,
  p_version_id uuid,
  p_question_text text,
  p_explanation text,
  p_image_path text,
  p_metadata jsonb,
  p_choices jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_version_status text;
  v_version_question_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can save drafts' USING ERRCODE = '42501';
  END IF;

  IF p_choices IS NULL OR jsonb_typeof(p_choices) != 'array' THEN
    RAISE EXCEPTION 'Choices must be a JSON array' USING ERRCODE = '22023';
  END IF;

  SELECT status, question_id
  INTO v_version_status, v_version_question_id
  FROM public.exam_question_versions
  WHERE id = p_version_id
    AND question_id = p_question_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draft version not found' USING ERRCODE = '22P02';
  END IF;

  IF v_version_status != 'draft' THEN
    RAISE EXCEPTION 'Only draft versions can be saved' USING ERRCODE = '42501';
  END IF;

  UPDATE public.exam_question_versions
  SET
    question_text = COALESCE(p_question_text, ''),
    explanation = NULLIF(p_explanation, ''),
    image_path = NULLIF(p_image_path, ''),
    metadata = COALESCE(p_metadata, '{}'::jsonb),
    updated_at = now(),
    updated_by = auth.uid()
  WHERE id = p_version_id
    AND question_id = p_question_id
    AND status = 'draft';

  DELETE FROM public.exam_question_choices
  WHERE question_version_id = p_version_id;

  INSERT INTO public.exam_question_choices (
    id, question_version_id, choice_key, label, is_correct, sort_order,
    created_at, updated_at, updated_by
  )
  SELECT
    gen_random_uuid(),
    p_version_id,
    choice_key,
    label,
    COALESCE(is_correct, false),
    sort_order,
    now(),
    now(),
    auth.uid()
  FROM jsonb_to_recordset(p_choices) AS choice(
    choice_key text,
    label text,
    is_correct boolean,
    sort_order integer
  );

  RETURN true;
END;
$$;

-- ============================================================================
-- 6. GRANT PERMISSIONS ON NEW FUNCTIONS
-- ============================================================================

REVOKE ALL ON FUNCTION public.create_exam_question_draft(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.publish_exam_question_version(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restore_exam_question_version_as_draft(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_exam_series_draft(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.publish_exam_series_version(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_exam_question_draft(uuid, uuid, text, text, text, jsonb, jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_exam_question_draft(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_exam_question_version(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_exam_question_version_as_draft(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_exam_series_draft(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_exam_series_version(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_exam_question_draft(uuid, uuid, text, text, text, jsonb, jsonb) TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_series TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_series_versions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_questions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_question_versions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_question_choices TO service_role;

NOTIFY pgrst, 'reload schema';
