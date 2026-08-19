-- eAutoecole V3.1 control center
-- Settings, notifications, audit, security events and session invalidation.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin';
$$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS session_invalid_before timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.app_settings (
  id text PRIMARY KEY DEFAULT 'global' CHECK (id = 'global'),
  maintenance_enabled boolean NOT NULL DEFAULT false,
  maintenance_title text NOT NULL DEFAULT 'Maintenance en cours',
  maintenance_message text NOT NULL DEFAULT 'Nous effectuons actuellement des améliorations sur eAutoecole.',
  maintenance_until timestamptz,
  school_name text NOT NULL DEFAULT 'Auto-école',
  support_phone text NOT NULL DEFAULT '77 583 20 37',
  whatsapp_phone text NOT NULL DEFAULT '221775832037',
  support_email text NOT NULL DEFAULT 'eautoecole1@gmail.com',
  support_address text NOT NULL DEFAULT 'Dakar HLM5, Castors Parc Nadio, Keurmassar',
  examen_poids_leger_enabled boolean NOT NULL DEFAULT false,
  examen_poids_lourd_enabled boolean NOT NULL DEFAULT false,
  announcement_title text,
  announcement_message text,
  announcement_expires_at timestamptz,
  session_invalid_before timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

INSERT INTO public.app_settings (id)
VALUES ('global')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_maintenance_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT maintenance_enabled FROM public.app_settings WHERE id = 'global'), false);
$$;

DROP POLICY IF EXISTS "update_own_profile" ON public.profiles;
CREATE POLICY "update_own_profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING  (auth.uid() = id AND NOT public.is_maintenance_enabled())
  WITH CHECK (auth.uid() = id AND NOT public.is_maintenance_enabled());

CREATE TABLE IF NOT EXISTS public.user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  type text NOT NULL DEFAULT 'information' CHECK (type IN ('information', 'important', 'maintenance', 'success')),
  requires_ack boolean NOT NULL DEFAULT false,
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notification_receipts (
  notification_id uuid NOT NULL REFERENCES public.user_notifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES auth.users(id),
  action text NOT NULL,
  target_user_id uuid REFERENCES auth.users(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  event_type text NOT NULL,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('low', 'info', 'important', 'critical')),
  source text NOT NULL DEFAULT 'server',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "settings_read_authenticated" ON public.app_settings;
CREATE POLICY "settings_read_authenticated"
  ON public.app_settings FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "settings_admin_update" ON public.app_settings;
CREATE POLICY "settings_admin_update"
  ON public.app_settings FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "notifications_read_target_or_admin" ON public.user_notifications;
CREATE POLICY "notifications_read_target_or_admin"
  ON public.user_notifications FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR target_user_id IS NULL
    OR target_user_id = auth.uid()
  );

DROP POLICY IF EXISTS "notifications_admin_insert" ON public.user_notifications;
CREATE POLICY "notifications_admin_insert"
  ON public.user_notifications FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "receipts_read_own_or_admin" ON public.notification_receipts;
CREATE POLICY "receipts_read_own_or_admin"
  ON public.notification_receipts FOR SELECT TO authenticated
  USING (public.is_admin() OR user_id = auth.uid());

DROP POLICY IF EXISTS "receipts_insert_own" ON public.notification_receipts;
CREATE POLICY "receipts_insert_own"
  ON public.notification_receipts FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "audit_read_admin" ON public.admin_audit_logs;
CREATE POLICY "audit_read_admin"
  ON public.admin_audit_logs FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "security_read_admin" ON public.security_events;
CREATE POLICY "security_read_admin"
  ON public.security_events FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "security_client_insert_low_trust" ON public.security_events;
CREATE POLICY "security_client_insert_low_trust"
  ON public.security_events FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND source = 'client_security_signal'
    AND severity = 'low'
  );

REVOKE ALL ON public.app_settings FROM anon;
REVOKE ALL ON public.user_notifications FROM anon;
REVOKE ALL ON public.notification_receipts FROM anon;
REVOKE ALL ON public.admin_audit_logs FROM anon;
REVOKE ALL ON public.security_events FROM anon;

GRANT SELECT ON public.app_settings TO authenticated;
GRANT SELECT ON public.user_notifications TO authenticated;
GRANT SELECT, INSERT ON public.notification_receipts TO authenticated;
GRANT SELECT ON public.admin_audit_logs TO authenticated;
GRANT SELECT, INSERT ON public.security_events TO authenticated;
