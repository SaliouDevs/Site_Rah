-- Admin-managed exam image overrides and exam publication status.

CREATE TABLE IF NOT EXISTS public.exam_question_images (
  question_id text PRIMARY KEY,
  exam_key text NOT NULL CHECK (exam_key IN ('light', 'heavy')),
  series_id text,
  storage_path text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  CHECK (question_id ~ '^(PL|PLD)-[0-9]{3}$'),
  CHECK (storage_path LIKE exam_key || '/%')
);

CREATE TABLE IF NOT EXISTS public.exam_settings (
  exam_key text PRIMARY KEY CHECK (exam_key IN ('light', 'heavy')),
  status text NOT NULL DEFAULT 'verification' CHECK (status IN ('verification', 'online', 'offline')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

INSERT INTO public.exam_settings (exam_key, status)
VALUES ('light', 'verification'), ('heavy', 'verification')
ON CONFLICT (exam_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_exam_question_images_updated_at ON public.exam_question_images;
CREATE TRIGGER set_exam_question_images_updated_at
  BEFORE UPDATE ON public.exam_question_images
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_exam_settings_updated_at ON public.exam_settings;
CREATE TRIGGER set_exam_settings_updated_at
  BEFORE UPDATE ON public.exam_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.exam_question_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "exam_images_read_authenticated" ON public.exam_question_images;
CREATE POLICY "exam_images_read_authenticated"
  ON public.exam_question_images FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "exam_images_admin_insert" ON public.exam_question_images;
CREATE POLICY "exam_images_admin_insert"
  ON public.exam_question_images FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() AND updated_by = auth.uid());

DROP POLICY IF EXISTS "exam_images_admin_update" ON public.exam_question_images;
CREATE POLICY "exam_images_admin_update"
  ON public.exam_question_images FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin() AND updated_by = auth.uid());

DROP POLICY IF EXISTS "exam_images_admin_delete" ON public.exam_question_images;
CREATE POLICY "exam_images_admin_delete"
  ON public.exam_question_images FOR DELETE TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "exam_settings_read_authenticated" ON public.exam_settings;
CREATE POLICY "exam_settings_read_authenticated"
  ON public.exam_settings FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "exam_settings_admin_update" ON public.exam_settings;
CREATE POLICY "exam_settings_admin_update"
  ON public.exam_settings FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin() AND updated_by = auth.uid());

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'exam-images',
  'exam-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "exam_images_storage_public_read" ON storage.objects;
CREATE POLICY "exam_images_storage_public_read"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'exam-images');

DROP POLICY IF EXISTS "exam_images_storage_admin_insert" ON storage.objects;
CREATE POLICY "exam_images_storage_admin_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'exam-images'
    AND public.is_admin()
    AND (storage.foldername(name))[1] IN ('light', 'heavy')
  );

DROP POLICY IF EXISTS "exam_images_storage_admin_update" ON storage.objects;
CREATE POLICY "exam_images_storage_admin_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'exam-images' AND public.is_admin())
  WITH CHECK (
    bucket_id = 'exam-images'
    AND public.is_admin()
    AND (storage.foldername(name))[1] IN ('light', 'heavy')
  );

DROP POLICY IF EXISTS "exam_images_storage_admin_delete" ON storage.objects;
CREATE POLICY "exam_images_storage_admin_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'exam-images' AND public.is_admin());

REVOKE ALL ON public.exam_question_images FROM anon;
REVOKE ALL ON public.exam_settings FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_question_images TO authenticated;
GRANT SELECT, UPDATE ON public.exam_settings TO authenticated;
