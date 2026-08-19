-- ================================================================
-- SUPABASE SETUP — eAutoecole
-- Coller dans : Dashboard > SQL Editor > New query
-- ================================================================

-- ----------------------------------------------------------------
-- 1. TABLE PROFILES
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id         UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  prenom     TEXT        NOT NULL DEFAULT 'Élève',
  telephone  TEXT        UNIQUE NOT NULL,
  formule    TEXT        NOT NULL DEFAULT 'Formule Illimitée',
  prix       INTEGER     NOT NULL DEFAULT 2000,
  status     TEXT        NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'active', 'blocked')),
  photo_url  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------
-- 2. ROW LEVEL SECURITY
-- ----------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- SELECT : chaque utilisateur voit son propre profil ; l'admin voit tout
CREATE POLICY "select_own_or_admin"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    (SELECT auth.uid()) = id
    OR (SELECT auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- UPDATE : chaque utilisateur peut modifier son propre profil
-- (les colonnes autorisées sont limitées par GRANT ci-dessous)
CREATE POLICY "update_own_profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING  ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

-- Restreindre les colonnes modifiables par les élèves (pas status, pas formule)
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT  UPDATE (prenom, photo_url) ON public.profiles TO authenticated;

-- ----------------------------------------------------------------
-- 3. TRIGGER : CRÉER LE PROFIL AUTOMATIQUEMENT À L'INSCRIPTION
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, prenom, telephone, formule, prix)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'prenom',   'Élève'),
    COALESCE(NEW.raw_user_meta_data ->> 'telephone', ''),
    COALESCE(NEW.raw_user_meta_data ->> 'formule',   'Formule Illimitée'),
    COALESCE((NEW.raw_user_meta_data ->> 'prix')::INTEGER, 2000)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ----------------------------------------------------------------
-- 4. FONCTION ADMIN : CHANGER LE STATUT D'UN UTILISATEUR
--    Appelée via supabase.rpc('admin_update_status', {...})
--    SECURITY DEFINER → bypass RLS, mais vérifie le rôle admin d'abord
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_status(
  target_user_id UUID,
  new_status      TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  -- Vérifier que l'appelant est admin (via app_metadata, pas user_metadata)
  IF (SELECT auth.jwt() -> 'app_metadata' ->> 'role') <> 'admin' THEN
    RAISE EXCEPTION 'Accès refusé — rôle admin requis';
  END IF;

  IF new_status NOT IN ('pending', 'active', 'blocked') THEN
    RAISE EXCEPTION 'Statut invalide : %', new_status;
  END IF;

  UPDATE public.profiles
  SET    status = new_status
  WHERE  id = target_user_id
  RETURNING row_to_json(profiles.*) INTO result;

  RETURN result;
END;
$$;

-- Seuls les utilisateurs authentifiés peuvent appeler cette fonction
REVOKE EXECUTE ON FUNCTION public.admin_update_status FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_update_status TO authenticated;

-- ----------------------------------------------------------------
-- FIN DU SETUP
-- Après avoir exécuté ce script :
--   • Désactiver la confirmation email :
--     Authentication > Email > "Confirm email" → OFF
--   • Créer le bucket Storage "avatars" (public) avec ces policies :
--     INSERT/UPDATE : (bucket_id = 'avatars') AND (auth.uid()::text = (storage.foldername(name))[1])
--     SELECT        : (bucket_id = 'avatars')   ← lecture publique
-- ----------------------------------------------------------------
