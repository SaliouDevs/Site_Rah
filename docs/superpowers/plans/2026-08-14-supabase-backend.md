# Supabase Backend — eAutoecole Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer l'authentification localStorage par un vrai backend Supabase
avec abonnement Wave manuel et panel admin.

**Architecture:** Site vanilla HTML/JS sur Vercel. Supabase Client importé via
CDN ES module. Téléphone converti en email interne `{tel}@eautoecole.sn` pour
éviter SMS payants. Sécurité via RLS Supabase.

**Tech Stack:** HTML5, CSS3, JavaScript ES6 modules, Supabase JS v2 (CDN),
Supabase Auth + Database + Storage, Vercel

**Spec:** `docs/superpowers/specs/2026-08-14-supabase-backend-design.md`

## Global Constraints

- Vanilla HTML/CSS/JS uniquement — aucun framework, aucun bundler
- Importer Supabase via CDN :
  `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm`
- Tous les scripts utilisant Supabase doivent avoir `type="module"`
- RLS activé sur toutes les tables exposées
- Ne jamais exposer la `service_role` key côté client — `anon key` uniquement
- Langue de l'interface : français
- Design cohérent avec le site existant (variables CSS, dark mode)
- Aucune confirmation email (désactivée dans Supabase Auth)
- Pas de reset mot de passe automatique (admin gère manuellement)

---

## Fichiers

| Action   | Fichier        | Responsabilité                                                     |
| -------- | -------------- | ------------------------------------------------------------------ |
| Créer    | `supabase.js`  | Client Supabase + toutes les fonctions partagées                   |
| Créer    | `auth.html`    | Page inscription / connexion                                       |
| Créer    | `payment.html` | Instructions Wave + upload capture d'écran                         |
| Créer    | `admin.html`   | Panel admin : demandes, utilisateurs                               |
| Modifier | `index.html`   | Supprimer auth localStorage, ajouter vérification session Supabase |

---

## Task 1 : Créer le projet Supabase et configurer Auth

**Files:**

- Aucun fichier à modifier — actions dans le dashboard Supabase

**Interfaces:**

- Produit : `SUPABASE_URL` et `SUPABASE_ANON_KEY` utilisés dans Task 4

- [ ] **Step 1 : Créer un compte et un projet Supabase**

  Aller sur https://supabase.com → "Start your project" → créer un compte.

  Créer un nouveau projet :
  - **Name :** `eautoecole`
  - **Database Password :** choisir un mot de passe fort (le noter)
  - **Region :** choisir `West EU (Ireland)` ou `US East` (le plus proche
    disponible)

  Attendre ~2 minutes que le projet soit prêt.

- [ ] **Step 2 : Désactiver la confirmation email**

  Dans le dashboard Supabase : `Authentication` → `Providers` → `Email` →
  décocher **"Confirm email"** → Save.

  Pourquoi : on utilise de faux emails internes `{tel}@eautoecole.sn`, donc
  aucun email ne peut être confirmé.

- [ ] **Step 3 : Récupérer les clés API**

  `Project Settings` → `API` → noter :
  - **Project URL** : `https://xxxxxxxxxxxx.supabase.co`
  - **anon public key** : `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

  Ces deux valeurs seront utilisées dans `supabase.js` (Task 4).

- [ ] **Step 4 : Vérifier**

  Dans `Authentication` → `Users` : la liste est vide. Le projet est prêt.

---

## Task 2 : Créer les tables et politiques RLS

**Files:**

- Aucun fichier code — SQL à exécuter dans Supabase SQL Editor

**Interfaces:**

- Produit : tables `profiles`, `subscriptions`, `payment_requests` avec RLS —
  utilisées dans toutes les tâches suivantes

- [ ] **Step 1 : Ouvrir le SQL Editor**

  Dans le dashboard Supabase : `SQL Editor` → `New query`

- [ ] **Step 2 : Créer les tables**

  Copier-coller et exécuter ce SQL :

  ```sql
  -- Table profiles (complète auth.users)
  CREATE TABLE public.profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    telephone text UNIQUE NOT NULL,
    nom_complet text,
    role text NOT NULL DEFAULT 'user',
    is_active boolean NOT NULL DEFAULT false,
    created_at timestamptz DEFAULT now()
  );

  -- Table subscriptions
  CREATE TABLE public.subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    montant integer NOT NULL DEFAULT 2000,
    statut text NOT NULL DEFAULT 'pending',
    created_at timestamptz DEFAULT now(),
    activated_at timestamptz
  );

  -- Table payment_requests
  CREATE TABLE public.payment_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    screenshot_url text NOT NULL,
    statut text NOT NULL DEFAULT 'pending',
    note_admin text,
    created_at timestamptz DEFAULT now(),
    reviewed_at timestamptz,
    reviewed_by uuid REFERENCES public.profiles(id)
  );
  ```

- [ ] **Step 3 : Créer le trigger auto-création de profil**

  Nouvelle query — copier-coller et exécuter :

  ```sql
  -- Fonction appelée à chaque nouvel utilisateur Supabase Auth
  CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = public
  AS $$
  BEGIN
    INSERT INTO public.profiles (id, telephone, nom_complet)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'telephone', ''),
      COALESCE(NEW.raw_user_meta_data->>'nom_complet', '')
    );
    RETURN NEW;
  END;
  $$;

  -- Trigger déclenché après INSERT dans auth.users
  CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  ```

- [ ] **Step 4 : Activer RLS sur toutes les tables**

  ```sql
  ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;
  ```

- [ ] **Step 5 : Créer la fonction helper is_admin()**

  ```sql
  CREATE OR REPLACE FUNCTION public.is_admin()
  RETURNS boolean
  LANGUAGE sql
  SECURITY INVOKER
  STABLE
  AS $$
    SELECT COALESCE(
      (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
      false
    );
  $$;
  ```

- [ ] **Step 6 : Créer les politiques RLS**

  ```sql
  -- === PROFILES ===

  -- Un utilisateur peut lire son propre profil ; l'admin peut lire tous
  CREATE POLICY "select_own_or_admin"
    ON public.profiles FOR SELECT
    TO authenticated
    USING ((SELECT auth.uid()) = id OR public.is_admin());

  -- Un utilisateur peut modifier uniquement son propre profil
  CREATE POLICY "update_own"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING ((SELECT auth.uid()) = id)
    WITH CHECK ((SELECT auth.uid()) = id);

  -- === SUBSCRIPTIONS ===

  -- Un utilisateur peut lire sa propre souscription ; l'admin peut lire toutes
  CREATE POLICY "select_own_or_admin"
    ON public.subscriptions FOR SELECT
    TO authenticated
    USING ((SELECT auth.uid()) = user_id OR public.is_admin());

  -- Seul l'admin peut insérer une souscription (lors de l'approbation)
  CREATE POLICY "insert_admin_only"
    ON public.subscriptions FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin());

  -- Seul l'admin peut modifier une souscription
  CREATE POLICY "update_admin_only"
    ON public.subscriptions FOR UPDATE
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

  -- === PAYMENT_REQUESTS ===

  -- Un utilisateur peut voir ses propres demandes ; l'admin voit tout
  CREATE POLICY "select_own_or_admin"
    ON public.payment_requests FOR SELECT
    TO authenticated
    USING ((SELECT auth.uid()) = user_id OR public.is_admin());

  -- Un utilisateur peut soumettre une demande pour lui-même
  CREATE POLICY "insert_own"
    ON public.payment_requests FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT auth.uid()) = user_id);

  -- Seul l'admin peut mettre à jour une demande (approuver/rejeter)
  CREATE POLICY "update_admin_only"
    ON public.payment_requests FOR UPDATE
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());
  ```

- [ ] **Step 7 : Vérifier**

  Dans `Table Editor` : les 3 tables doivent apparaître avec le cadenas RLS
  activé.

---

## Task 3 : Configurer le Storage (captures Wave)

**Files:**

- Aucun fichier code — actions dans le dashboard Supabase

**Interfaces:**

- Produit : bucket `payment-screenshots` — utilisé dans Task 6 (`payment.html`)

- [ ] **Step 1 : Créer le bucket**

  `Storage` → `New bucket`
  - **Name :** `payment-screenshots`
  - **Public bucket :** NON (laisser décoché)
  - Cliquer "Create bucket"

- [ ] **Step 2 : Créer les politiques Storage**

  `Storage` → `payment-screenshots` → `Policies` → `New policy` → "For full
  customization"

  Exécuter ce SQL dans le SQL Editor :

  ```sql
  -- Les utilisateurs peuvent uploader dans leur propre dossier (uuid/)
  CREATE POLICY "upload_own_screenshot"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'payment-screenshots'
      AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
    );

  -- Les utilisateurs peuvent voir leurs propres captures
  CREATE POLICY "read_own_screenshot"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
      bucket_id = 'payment-screenshots'
      AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
    );

  -- L'admin peut voir toutes les captures
  CREATE POLICY "admin_read_all_screenshots"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
      bucket_id = 'payment-screenshots'
      AND public.is_admin()
    );
  ```

- [ ] **Step 3 : Vérifier**

  `Storage` → `payment-screenshots` → le bucket apparaît, vide, avec les
  politiques listées.

---

## Task 4 : Créer supabase.js (client partagé)

**Files:**

- Créer : `supabase.js`

**Interfaces:**

- Consomme : `SUPABASE_URL` et `SUPABASE_ANON_KEY` de Task 1
- Produit : `supabase` (client), `phoneToEmail()`, `getSession()`,
  `getProfile()`, `isAdmin()`, `signUp()`, `signIn()`, `signOut()`,
  `checkAccess()` — utilisés dans Tasks 5, 6, 7, 8

- [ ] **Step 1 : Créer le fichier supabase.js**

  Créer `/supabase.js` à la racine du projet avec ce contenu (remplacer les
  valeurs par celles de Task 1 Step 3) :

  ```javascript
  import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

  const SUPABASE_URL = "https://REMPLACER_PAR_VOTRE_URL.supabase.co";
  const SUPABASE_ANON_KEY = "REMPLACER_PAR_VOTRE_ANON_KEY";

  export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Convertit un numéro de téléphone en email interne Supabase
  export function phoneToEmail(telephone) {
    return `${telephone.replace(/\s+/g, "")}@eautoecole.sn`;
  }

  // Retourne la session active ou null
  export async function getSession() {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  }

  // Retourne le profil de l'utilisateur connecté ou null
  export async function getProfile() {
    const session = await getSession();
    if (!session) return null;
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .single();
    if (error) return null;
    return data;
  }

  // Retourne true si l'utilisateur connecté est admin
  export async function isAdmin() {
    const session = await getSession();
    if (!session) return false;
    return session.user.app_metadata?.role === "admin";
  }

  // Inscrit un nouvel utilisateur
  // telephone: string (ex: "762000000"), password: string, nomComplet: string
  // Retourne { data, error }
  export async function signUp(telephone, password, nomComplet) {
    const email = phoneToEmail(telephone);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          telephone: telephone.replace(/\s+/g, ""),
          nom_complet: nomComplet,
        },
      },
    });
    return { data, error };
  }

  // Connecte un utilisateur existant
  // telephone: string, password: string
  // Retourne { data, error }
  export async function signIn(telephone, password) {
    const email = phoneToEmail(telephone);
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { data, error };
  }

  // Déconnecte l'utilisateur
  export async function signOut() {
    const { error } = await supabase.auth.signOut();
    return { error };
  }

  // Vérifie l'accès et redirige si nécessaire.
  // À appeler en haut de chaque page protégée.
  // Retourne le profil si accès autorisé, null sinon (avec redirect).
  export async function checkAccess() {
    const session = await getSession();
    if (!session) {
      window.location.href = "/auth.html";
      return null;
    }
    // Les admins ont toujours accès
    if (await isAdmin()) {
      return await getProfile();
    }
    const profile = await getProfile();
    if (!profile?.is_active) {
      window.location.href = "/payment.html";
      return null;
    }
    return profile;
  }
  ```

- [ ] **Step 2 : Vérifier la syntaxe**

  Ouvrir `supabase.js` dans un éditeur et vérifier :
  - `SUPABASE_URL` commence par `https://` et se termine par `.supabase.co`
  - `SUPABASE_ANON_KEY` commence par `eyJ`
  - Aucune erreur de syntaxe visible

- [ ] **Step 3 : Test rapide dans la console navigateur**

  Ouvrir n'importe quel fichier HTML du projet dans le navigateur (via `file://`
  ou un serveur local). Ouvrir la console et taper :

  ```javascript
  // Test temporaire — à supprimer après
  import("/supabase.js").then((m) => {
    m.getSession().then((s) => console.log("Session:", s));
  });
  ```

  Résultat attendu : `Session: null` (personne connecté). Si erreur réseau →
  vérifier l'URL Supabase.

---

## Task 5 : Créer auth.html (inscription / connexion)

**Files:**

- Créer : `auth.html`

**Interfaces:**

- Consomme : `signUp()`, `signIn()` depuis `supabase.js`
- Produit : session Supabase active → redirect vers `index.html`

- [ ] **Step 1 : Créer auth.html**

  ```html
  <!DOCTYPE html>
  <html lang="fr">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>eAutoecole — Connexion</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link
        href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      >
      <link
        rel="stylesheet"
        href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
      >
      <style>
        :root {
          --primary: #e74c3c;
          --primary-dark: #c0392b;
          --bg: #f5f6fa;
          --card: #ffffff;
          --text: #2c3e50;
          --text-light: #7f8c8d;
          --border: #dfe6e9;
          --success: #27ae60;
          --error: #e74c3c;
          --input-bg: #f8f9fa;
        }
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: "Montserrat", sans-serif;
          background: var(--bg);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .auth-container {
          background: var(--card);
          border-radius: 16px;
          box-shadow: 0 4px 24px rgba(0, 0, 0, 0.1);
          width: 100%;
          max-width: 420px;
          overflow: hidden;
        }
        .auth-header {
          background: var(--primary);
          padding: 32px 24px;
          text-align: center;
          color: white;
        }
        .auth-header .logo {
          font-size: 2rem;
          margin-bottom: 8px;
        }
        .auth-header h1 {
          font-size: 1.4rem;
          font-weight: 700;
        }
        .auth-header p {
          font-size: 0.85rem;
          opacity: 0.9;
          margin-top: 4px;
        }
        .tabs {
          display: flex;
          border-bottom: 1px solid var(--border);
        }
        .tab-btn {
          flex: 1;
          padding: 14px;
          background: none;
          border: none;
          font-family: "Montserrat", sans-serif;
          font-size: 0.9rem;
          font-weight: 600;
          color: var(--text-light);
          cursor: pointer;
          border-bottom: 3px solid transparent;
          transition: all 0.2s;
        }
        .tab-btn.active {
          color: var(--primary);
          border-bottom-color: var(--primary);
        }
        .tab-content {
          display: none;
          padding: 28px 24px;
        }
        .tab-content.active {
          display: block;
        }
        .form-group {
          margin-bottom: 18px;
        }
        label {
          display: block;
          font-size: 0.8rem;
          font-weight: 600;
          color: var(--text);
          margin-bottom: 6px;
        }
        .input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }
        .input-wrapper i {
          position: absolute;
          left: 12px;
          color: var(--text-light);
          font-size: 0.9rem;
        }
        input {
          width: 100%;
          padding: 12px 12px 12px 36px;
          border: 1.5px solid var(--border);
          border-radius: 8px;
          font-family: "Montserrat", sans-serif;
          font-size: 0.95rem;
          background: var(--input-bg);
          color: var(--text);
          transition: border-color 0.2s;
          outline: none;
        }
        input:focus {
          border-color: var(--primary);
        }
        .btn-primary {
          width: 100%;
          padding: 14px;
          background: var(--primary);
          color: white;
          border: none;
          border-radius: 8px;
          font-family: "Montserrat", sans-serif;
          font-size: 0.95rem;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s;
          margin-top: 4px;
        }
        .btn-primary:hover {
          background: var(--primary-dark);
        }
        .btn-primary:disabled {
          background: #ccc;
          cursor: not-allowed;
        }
        .message {
          padding: 12px;
          border-radius: 8px;
          font-size: 0.85rem;
          text-align: center;
          margin-top: 16px;
          display: none;
        }
        .message.error {
          background: #fdecea;
          color: var(--error);
          display: block;
        }
        .message.success {
          background: #eafaf1;
          color: var(--success);
          display: block;
        }
        .contact-admin {
          text-align: center;
          margin-top: 16px;
          font-size: 0.8rem;
          color: var(--text-light);
        }
      </style>
    </head>
    <body>
      <div class="auth-container">
        <div class="auth-header">
          <div class="logo">🚗</div>
          <h1>eAutoecole</h1>
          <p>Auto-École</p>
        </div>

        <div class="tabs">
          <button class="tab-btn active" onclick='switchTab("connexion")'>
            <i class="fas fa-sign-in-alt"></i> Connexion
          </button>
          <button class="tab-btn" onclick='switchTab("inscription")'>
            <i class="fas fa-user-plus"></i> Inscription
          </button>
        </div>

        <!-- Connexion -->
        <div id="tab-connexion" class="tab-content active">
          <form id="form-connexion" onsubmit="handleConnexion(event)">
            <div class="form-group">
              <label>Numéro de téléphone</label>
              <div class="input-wrapper">
                <i class="fas fa-phone"></i>
                <input
                  type="tel"
                  id="login-tel"
                  placeholder="Ex: 762000000"
                  required
                >
              </div>
            </div>
            <div class="form-group">
              <label>Mot de passe</label>
              <div class="input-wrapper">
                <i class="fas fa-lock"></i>
                <input
                  type="password"
                  id="login-pwd"
                  placeholder="Votre mot de passe"
                  required
                >
              </div>
            </div>
            <button type="submit" class="btn-primary" id="btn-connexion">
              <i class="fas fa-sign-in-alt"></i> Se connecter
            </button>
            <div id="msg-connexion" class="message"></div>
          </form>
          <p class="contact-admin">
            Mot de passe oublié ? Contactez l'administrateur.
          </p>
        </div>

        <!-- Inscription -->
        <div id="tab-inscription" class="tab-content">
          <form id="form-inscription" onsubmit="handleInscription(event)">
            <div class="form-group">
              <label>Nom complet</label>
              <div class="input-wrapper">
                <i class="fas fa-user"></i>
                <input
                  type="text"
                  id="reg-nom"
                  placeholder="Votre nom et prénom"
                  required
                >
              </div>
            </div>
            <div class="form-group">
              <label>Numéro de téléphone</label>
              <div class="input-wrapper">
                <i class="fas fa-phone"></i>
                <input
                  type="tel"
                  id="reg-tel"
                  placeholder="Ex: 762000000"
                  required
                >
              </div>
            </div>
            <div class="form-group">
              <label>Mot de passe</label>
              <div class="input-wrapper">
                <i class="fas fa-lock"></i>
                <input
                  type="password"
                  id="reg-pwd"
                  placeholder="Minimum 8 caractères"
                  minlength="8"
                  required
                >
              </div>
            </div>
            <div class="form-group">
              <label>Confirmer le mot de passe</label>
              <div class="input-wrapper">
                <i class="fas fa-lock"></i>
                <input
                  type="password"
                  id="reg-pwd2"
                  placeholder="Répéter le mot de passe"
                  required
                >
              </div>
            </div>
            <button type="submit" class="btn-primary" id="btn-inscription">
              <i class="fas fa-user-plus"></i> Créer mon compte
            </button>
            <div id="msg-inscription" class="message"></div>
          </form>
        </div>
      </div>

      <script type="module">
        import { getSession, signIn, signUp } from "/supabase.js";

        // Si déjà connecté, rediriger
        getSession().then((session) => {
          if (session) window.location.href = "/index.html";
        });

        window.switchTab = function (tab) {
          document.querySelectorAll(".tab-btn").forEach((b, i) => {
            b.classList.toggle(
              "active",
              (i === 0 && tab === "connexion") ||
                (i === 1 && tab === "inscription"),
            );
          });
          document.getElementById("tab-connexion").classList.toggle(
            "active",
            tab === "connexion",
          );
          document.getElementById("tab-inscription").classList.toggle(
            "active",
            tab === "inscription",
          );
        };

        function showMsg(id, text, type) {
          const el = document.getElementById(id);
          el.textContent = text;
          el.className = `message ${type}`;
        }

        window.handleConnexion = async function (e) {
          e.preventDefault();
          const btn = document.getElementById("btn-connexion");
          btn.disabled = true;
          btn.textContent = "Connexion...";

          const telephone = document.getElementById("login-tel").value.trim();
          const password = document.getElementById("login-pwd").value;

          const { error } = await signIn(telephone, password);

          if (error) {
            showMsg(
              "msg-connexion",
              "Numéro ou mot de passe incorrect.",
              "error",
            );
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Se connecter';
          } else {
            window.location.href = "/index.html";
          }
        };

        window.handleInscription = async function (e) {
          e.preventDefault();
          const btn = document.getElementById("btn-inscription");
          const pwd = document.getElementById("reg-pwd").value;
          const pwd2 = document.getElementById("reg-pwd2").value;

          if (pwd !== pwd2) {
            showMsg(
              "msg-inscription",
              "Les mots de passe ne correspondent pas.",
              "error",
            );
            return;
          }

          btn.disabled = true;
          btn.textContent = "Création...";

          const telephone = document.getElementById("reg-tel").value.trim();
          const nomComplet = document.getElementById("reg-nom").value.trim();

          const { error } = await signUp(telephone, pwd, nomComplet);

          if (error) {
            const msg = error.message.includes("already registered")
              ? "Ce numéro est déjà inscrit. Essayez de vous connecter."
              : "Erreur lors de l'inscription. Réessayez.";
            showMsg("msg-inscription", msg, "error");
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-user-plus"></i> Créer mon compte';
          } else {
            showMsg(
              "msg-inscription",
              "Compte créé ! Vous allez être redirigé...",
              "success",
            );
            setTimeout(() => window.location.href = "/index.html", 1500);
          }
        };
      </script>
    </body>
  </html>
  ```

- [ ] **Step 2 : Tester auth.html**

  Ouvrir `auth.html` dans le navigateur (via serveur local ou Vercel preview).

  **Test inscription :**
  - Remplir nom, téléphone (ex: `760000001`), mot de passe `test1234`, confirmer
  - Cliquer "Créer mon compte"
  - Résultat attendu : message vert + redirect vers index.html
  - Vérifier dans Supabase Dashboard → `Authentication` → `Users` : un
    utilisateur apparaît
  - Vérifier dans `Table Editor` → `profiles` : le profil est créé avec
    `is_active = false`

  **Test connexion :**
  - Aller sur auth.html → onglet Connexion
  - Entrer téléphone + mot de passe
  - Résultat attendu : redirect vers index.html

  **Test erreur :**
  - Entrer un mauvais mot de passe → message "Numéro ou mot de passe incorrect."

---

## Task 6 : Créer payment.html (upload capture Wave)

**Files:**

- Créer : `payment.html`

**Interfaces:**

- Consomme : `getSession()`, `getProfile()`, `supabase` depuis `supabase.js`
- Consomme : bucket `payment-screenshots` (Task 3)
- Consomme : tables `payment_requests` (Task 2)

- [ ] **Step 1 : Créer payment.html**

  ```html
  <!DOCTYPE html>
  <html lang="fr">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>eAutoecole — Abonnement</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link
        href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      >
      <link
        rel="stylesheet"
        href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
      >
      <style>
        :root {
          --primary: #e74c3c;
          --primary-dark: #c0392b;
          --wave: #00a0e3;
          --bg: #f5f6fa;
          --card: #ffffff;
          --text: #2c3e50;
          --text-light: #7f8c8d;
          --border: #dfe6e9;
          --success: #27ae60;
          --warning: #f39c12;
          --error: #e74c3c;
        }
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: "Montserrat", sans-serif;
          background: var(--bg);
          min-height: 100vh;
          padding: 20px;
        }
        .container {
          max-width: 500px;
          margin: 0 auto;
        }
        .header {
          text-align: center;
          padding: 24px 0;
        }
        .header h1 {
          font-size: 1.3rem;
          color: var(--text);
        }
        .header p {
          color: var(--text-light);
          font-size: 0.85rem;
          margin-top: 4px;
        }
        .card {
          background: var(--card);
          border-radius: 12px;
          box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
          padding: 24px;
          margin-bottom: 16px;
        }
        .price-badge {
          background: linear-gradient(135deg, #e74c3c, #c0392b);
          color: white;
          border-radius: 12px;
          padding: 20px;
          text-align: center;
          margin-bottom: 16px;
        }
        .price-badge .amount {
          font-size: 2.2rem;
          font-weight: 700;
        }
        .price-badge .label {
          font-size: 0.85rem;
          opacity: 0.9;
          margin-top: 4px;
        }
        .price-badge .lifetime {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 20px;
          padding: 4px 12px;
          font-size: 0.8rem;
          display: inline-block;
          margin-top: 8px;
        }
        .wave-section h3 {
          font-size: 0.95rem;
          color: var(--text);
          margin-bottom: 12px;
        }
        .wave-info {
          background: #e8f4fd;
          border: 1.5px solid var(--wave);
          border-radius: 8px;
          padding: 16px;
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .wave-icon {
          font-size: 1.8rem;
        }
        .wave-number {
          font-size: 1.3rem;
          font-weight: 700;
          color: var(--wave);
        }
        .wave-name {
          font-size: 0.8rem;
          color: var(--text-light);
        }
        .steps {
          list-style: none;
          counter-reset: steps;
        }
        .steps li {
          counter-increment: steps;
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 8px 0;
          font-size: 0.88rem;
          color: var(--text);
          border-bottom: 1px solid var(--border);
        }
        .steps li:last-child {
          border-bottom: none;
        }
        .steps li::before {
          content: counter(steps);
          background: var(--primary);
          color: white;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.75rem;
          font-weight: 700;
          flex-shrink: 0;
          margin-top: 1px;
        }
        .upload-zone {
          border: 2px dashed var(--border);
          border-radius: 8px;
          padding: 32px 20px;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s;
          position: relative;
        }
        .upload-zone:hover, .upload-zone.drag-over {
          border-color: var(--primary);
          background: #fef9f9;
        }
        .upload-zone i {
          font-size: 2rem;
          color: var(--text-light);
          margin-bottom: 8px;
        }
        .upload-zone p {
          font-size: 0.85rem;
          color: var(--text-light);
        }
        .upload-zone input[type="file"] {
          position: absolute;
          inset: 0;
          opacity: 0;
          cursor: pointer;
        }
        .preview-img {
          width: 100%;
          max-height: 200px;
          object-fit: contain;
          border-radius: 8px;
          border: 1px solid var(--border);
          display: none;
          margin-top: 12px;
        }
        .btn-primary {
          width: 100%;
          padding: 14px;
          background: var(--primary);
          color: white;
          border: none;
          border-radius: 8px;
          font-family: "Montserrat", sans-serif;
          font-size: 0.95rem;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s;
          margin-top: 16px;
        }
        .btn-primary:hover {
          background: var(--primary-dark);
        }
        .btn-primary:disabled {
          background: #ccc;
          cursor: not-allowed;
        }
        .status-card {
          border-radius: 8px;
          padding: 16px;
          margin-bottom: 16px;
        }
        .status-pending {
          background: #fff8e1;
          border-left: 4px solid var(--warning);
        }
        .status-rejected {
          background: #fdecea;
          border-left: 4px solid var(--error);
        }
        .status-card h4 {
          font-size: 0.9rem;
          margin-bottom: 4px;
        }
        .status-card p {
          font-size: 0.82rem;
          color: var(--text-light);
        }
        .message {
          padding: 12px;
          border-radius: 8px;
          font-size: 0.85rem;
          text-align: center;
          margin-top: 12px;
          display: none;
        }
        .message.error {
          background: #fdecea;
          color: var(--error);
          display: block;
        }
        .message.success {
          background: #eafaf1;
          color: var(--success);
          display: block;
        }
        .btn-logout {
          background: none;
          border: none;
          color: var(--text-light);
          font-size: 0.8rem;
          cursor: pointer;
          text-decoration: underline;
          display: block;
          margin: 16px auto 0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🚗 eAutoecole</h1>
          <p>Accès à la plateforme</p>
        </div>

        <div id="status-zone"></div>

        <div class="card" id="payment-card">
          <div class="price-badge">
            <div class="amount">2 000 FCFA</div>
            <div class="label">Accès complet à la plateforme</div>
            <div class="lifetime">✅ Accès à vie</div>
          </div>

          <div class="wave-section">
            <h3><i class="fas fa-mobile-alt"></i> Payez via Wave</h3>
            <div class="wave-info">
              <div class="wave-icon">📱</div>
              <div>
                <div class="wave-number" id="wave-number">77 XXX XX XX</div>
                <div class="wave-name">Auto-École</div>
              </div>
            </div>
          </div>

          <ul class="steps" style="margin-top: 20px; margin-bottom: 20px">
            <li>Ouvrez votre application Wave</li>
            <li>Envoyez 2 000 FCFA au numéro ci-dessus</li>
            <li>Prenez une capture d'écran de la confirmation</li>
            <li>Uploadez la capture ci-dessous</li>
            <li>Attendez la validation (quelques heures)</li>
          </ul>

          <div class="upload-zone" id="upload-zone">
            <input type="file" id="file-input" accept="image/*">
            <i class="fas fa-camera"></i>
            <p>Cliquer ou glisser votre capture d'écran ici</p>
          </div>
          <img id="preview" class="preview-img" alt="Aperçu">

          <button
            class="btn-primary"
            id="btn-submit"
            onclick="submitPayment()"
            disabled
          >
            <i class="fas fa-paper-plane"></i> Envoyer ma preuve de paiement
          </button>
          <div id="msg-payment" class="message"></div>
        </div>

        <button class="btn-logout" onclick="logout()">Se déconnecter</button>
      </div>

      <script type="module">
        import { getProfile, getSession, signOut, supabase } from "/supabase.js";

        // CONFIGURER : numéro Wave de l'auto-école
        const WAVE_NUMBER = "77 XXX XX XX";
        document.getElementById("wave-number").textContent = WAVE_NUMBER;

        let selectedFile = null;

        async function init() {
          const session = await getSession();
          if (!session) {
            window.location.href = "/auth.html";
            return;
          }

          const profile = await getProfile();
          if (profile?.is_active) {
            window.location.href = "/index.html";
            return;
          }

          // Vérifier si une demande existe déjà
          const { data: requests } = await supabase
            .from("payment_requests")
            .select("*")
            .eq("user_id", session.user.id)
            .order("created_at", { ascending: false })
            .limit(1);

          if (requests && requests.length > 0) {
            const req = requests[0];
            const zone = document.getElementById("status-zone");
            if (req.statut === "pending") {
              zone.innerHTML = `
              <div class="status-card status-pending">
                <h4>⏳ Demande en cours de vérification</h4>
                <p>Votre capture a été reçue. Un administrateur va valider votre paiement prochainement.</p>
              </div>`;
              document.getElementById("payment-card").style.display = "none";
              return;
            }
            if (req.statut === "rejected") {
              zone.innerHTML = `
              <div class="status-card status-rejected">
                <h4>❌ Demande rejetée</h4>
                <p>${
                req.note_admin ||
                "Capture non valide. Veuillez soumettre une nouvelle capture."
              }</p>
              </div>`;
            }
          }
        }

        // Prévisualisation du fichier
        document.getElementById("file-input").addEventListener("change", (e) => {
          selectedFile = e.target.files[0];
          if (!selectedFile) return;
          const reader = new FileReader();
          reader.onload = (ev) => {
            const preview = document.getElementById("preview");
            preview.src = ev.target.result;
            preview.style.display = "block";
          };
          reader.readAsDataURL(selectedFile);
          document.getElementById("btn-submit").disabled = false;
        });

        // Drag & drop
        const zone = document.getElementById("upload-zone");
        zone.addEventListener("dragover", (e) => {
          e.preventDefault();
          zone.classList.add("drag-over");
        });
        zone.addEventListener(
          "dragleave",
          () => zone.classList.remove("drag-over"),
        );
        zone.addEventListener("drop", (e) => {
          e.preventDefault();
          zone.classList.remove("drag-over");
          const file = e.dataTransfer.files[0];
          if (file && file.type.startsWith("image/")) {
            selectedFile = file;
            const reader = new FileReader();
            reader.onload = (ev) => {
              const preview = document.getElementById("preview");
              preview.src = ev.target.result;
              preview.style.display = "block";
            };
            reader.readAsDataURL(file);
            document.getElementById("btn-submit").disabled = false;
          }
        });

        window.submitPayment = async function () {
          if (!selectedFile) return;
          const btn = document.getElementById("btn-submit");
          btn.disabled = true;
          btn.textContent = "Envoi en cours...";

          const session = await getSession();
          const userId = session.user.id;
          const ext = selectedFile.name.split(".").pop();
          const path = `${userId}/${Date.now()}.${ext}`;

          // Upload vers Supabase Storage
          const { error: uploadError } = await supabase.storage
            .from("payment-screenshots")
            .upload(path, selectedFile);

          if (uploadError) {
            document.getElementById("msg-payment").className = "message error";
            document.getElementById("msg-payment").textContent =
              "Erreur lors de l'upload. Réessayez.";
            btn.disabled = false;
            btn.innerHTML =
              '<i class="fas fa-paper-plane"></i> Envoyer ma preuve de paiement';
            return;
          }

          // Créer la demande de paiement
          const { error: dbError } = await supabase
            .from("payment_requests")
            .insert({ user_id: userId, screenshot_url: path });

          if (dbError) {
            document.getElementById("msg-payment").className = "message error";
            document.getElementById("msg-payment").textContent =
              "Erreur lors de l'envoi. Réessayez.";
            btn.disabled = false;
            btn.innerHTML =
              '<i class="fas fa-paper-plane"></i> Envoyer ma preuve de paiement';
            return;
          }

          document.getElementById("msg-payment").className = "message success";
          document.getElementById("msg-payment").textContent =
            "Envoyé ! Un admin va vérifier votre paiement prochainement.";
          document.getElementById("payment-card").style.display = "none";
          document.getElementById("status-zone").innerHTML = `
          <div class="status-card status-pending">
            <h4>⏳ Demande en cours de vérification</h4>
            <p>Votre capture a été reçue. Un administrateur va valider votre paiement prochainement.</p>
          </div>`;
        };

        window.logout = async function () {
          await signOut();
          window.location.href = "/auth.html";
        };

        init();
      </script>
    </body>
  </html>
  ```

- [ ] **Step 2 : Configurer le numéro Wave**

  Dans `payment.html`, ligne `const WAVE_NUMBER = '77 XXX XX XX'`, remplacer par
  le vrai numéro Wave de l'auto-école.

- [ ] **Step 3 : Tester payment.html**

  - Se connecter avec un compte test (is_active = false)
  - Ouvrir payment.html → la page doit s'afficher (pas de redirect)
  - Uploader une image → aperçu visible, bouton actif
  - Cliquer "Envoyer" → message de succès
  - Vérifier dans Supabase Dashboard → `Table Editor` → `payment_requests` : une
    ligne avec `statut = 'pending'`
  - Recharger payment.html → affiche "Demande en cours de vérification"

---

## Task 7 : Créer admin.html (panel administrateur)

**Files:**

- Créer : `admin.html`

**Interfaces:**

- Consomme : `isAdmin()`, `supabase`, `getSession()`, `signOut()` depuis
  `supabase.js`
- Consomme : tables `payment_requests`, `profiles`, `subscriptions` (Task 2)
- Consomme : bucket `payment-screenshots` (Task 3)

- [ ] **Step 1 : Créer admin.html**

  ```html
  <!DOCTYPE html>
  <html lang="fr">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>eAutoecole — Admin</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link
        href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      >
      <link
        rel="stylesheet"
        href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
      >
      <style>
        :root {
          --primary: #e74c3c;
          --primary-dark: #c0392b;
          --bg: #f0f2f5;
          --card: #ffffff;
          --text: #2c3e50;
          --text-light: #7f8c8d;
          --border: #dfe6e9;
          --success: #27ae60;
          --warning: #f39c12;
          --error: #e74c3c;
          --sidebar: #2c3e50;
        }
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: "Montserrat", sans-serif;
          background: var(--bg);
          color: var(--text);
        }
        .layout {
          display: flex;
          min-height: 100vh;
        }
        .sidebar {
          width: 240px;
          background: var(--sidebar);
          color: white;
          display: flex;
          flex-direction: column;
          padding: 24px 0;
          flex-shrink: 0;
        }
        .sidebar-logo {
          padding: 0 20px 24px;
          font-size: 1.1rem;
          font-weight: 700;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          margin-bottom: 16px;
        }
        .sidebar-logo span {
          color: var(--primary);
        }
        .nav-btn {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 20px;
          background: none;
          border: none;
          color: rgba(255, 255, 255, 0.7);
          font-family: "Montserrat", sans-serif;
          font-size: 0.88rem;
          cursor: pointer;
          width: 100%;
          text-align: left;
          transition: all 0.2s;
        }
        .nav-btn:hover {
          background: rgba(255, 255, 255, 0.05);
          color: white;
        }
        .nav-btn.active {
          background: var(--primary);
          color: white;
        }
        .nav-btn .badge {
          margin-left: auto;
          background: var(--warning);
          color: white;
          border-radius: 10px;
          padding: 2px 7px;
          font-size: 0.75rem;
          font-weight: 700;
        }
        .btn-logout-side {
          margin-top: auto;
          padding: 0 20px;
        }
        .btn-logout-side button {
          width: 100%;
          padding: 10px;
          background: rgba(255, 255, 255, 0.1);
          border: none;
          border-radius: 8px;
          color: white;
          font-family: "Montserrat", sans-serif;
          font-size: 0.85rem;
          cursor: pointer;
        }
        .main {
          flex: 1;
          padding: 28px;
          overflow-y: auto;
        }
        .page {
          display: none;
        }
        .page.active {
          display: block;
        }
        .page-title {
          font-size: 1.2rem;
          font-weight: 700;
          margin-bottom: 20px;
        }
        .card {
          background: var(--card);
          border-radius: 12px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
          overflow: hidden;
        }
        table {
          width: 100%;
          border-collapse: collapse;
        }
        th {
          background: #f8f9fa;
          padding: 12px 16px;
          text-align: left;
          font-size: 0.78rem;
          font-weight: 600;
          color: var(--text-light);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        td {
          padding: 14px 16px;
          font-size: 0.88rem;
          border-bottom: 1px solid var(--border);
        }
        tr:last-child td {
          border-bottom: none;
        }
        .badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px 10px;
          border-radius: 20px;
          font-size: 0.78rem;
          font-weight: 600;
        }
        .badge-pending {
          background: #fff8e1;
          color: var(--warning);
        }
        .badge-approved, .badge-active {
          background: #eafaf1;
          color: var(--success);
        }
        .badge-rejected, .badge-inactive {
          background: #fdecea;
          color: var(--error);
        }
        .btn-sm {
          padding: 6px 12px;
          border: none;
          border-radius: 6px;
          font-family: "Montserrat", sans-serif;
          font-size: 0.8rem;
          font-weight: 600;
          cursor: pointer;
          margin-right: 6px;
        }
        .btn-approve {
          background: var(--success);
          color: white;
        }
        .btn-reject {
          background: var(--error);
          color: white;
        }
        .btn-toggle {
          background: #e8f4fd;
          color: #0077b6;
        }
        .btn-view {
          background: #f0f0f0;
          color: var(--text);
        }
        .empty {
          text-align: center;
          padding: 40px;
          color: var(--text-light);
          font-size: 0.9rem;
        }
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          display: none;
        }
        .modal-overlay.open {
          display: flex;
        }
        .modal {
          background: white;
          border-radius: 12px;
          padding: 24px;
          max-width: 90vw;
          max-height: 90vh;
          overflow: auto;
        }
        .modal img {
          max-width: 400px;
          max-height: 70vh;
          object-fit: contain;
          border-radius: 8px;
        }
        .modal-actions {
          margin-top: 16px;
          display: flex;
          gap: 8px;
          justify-content: flex-end;
        }
        .reject-input {
          width: 100%;
          padding: 10px;
          border: 1.5px solid var(--border);
          border-radius: 8px;
          font-family: "Montserrat", sans-serif;
          font-size: 0.88rem;
          margin-top: 12px;
          outline: none;
        }
        .reject-input:focus {
          border-color: var(--error);
        }
        @media (max-width: 768px) {
          .sidebar {
            width: 60px;
          }
          .sidebar-logo, .nav-btn span, .btn-logout-side {
            display: none;
          }
          .nav-btn {
            justify-content: center;
            padding: 16px;
          }
        }
      </style>
    </head>
    <body>
      <div class="layout">
        <div class="sidebar">
          <div class="sidebar-logo">🚗 <span>Admin</span></div>
          <button
            class="nav-btn active"
            onclick='showPage("demandes")'
            id="nav-demandes"
          >
            <i class="fas fa-clock"></i>
            <span>Demandes</span>
            <span class="badge" id="badge-count" style="display: none">0</span>
          </button>
          <button
            class="nav-btn"
            onclick='showPage("utilisateurs")'
            id="nav-utilisateurs"
          >
            <i class="fas fa-users"></i>
            <span>Utilisateurs</span>
          </button>
          <div class="btn-logout-side">
            <button onclick="logout()">
              <i class="fas fa-sign-out-alt"></i> Déconnexion
            </button>
          </div>
        </div>

        <div class="main">
          <!-- Page Demandes -->
          <div class="page active" id="page-demandes">
            <div class="page-title">Demandes de paiement</div>
            <div class="card">
              <table>
                <thead>
                  <tr>
                    <th>Utilisateur</th>
                    <th>Téléphone</th>
                    <th>Date</th>
                    <th>Statut</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody id="demandes-body">
                  <tr><td colspan="5" class="empty">Chargement...</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Page Utilisateurs -->
          <div class="page" id="page-utilisateurs">
            <div class="page-title">Gestion des utilisateurs</div>
            <div class="card">
              <table>
                <thead>
                  <tr>
                    <th>Nom</th>
                    <th>Téléphone</th>
                    <th>Statut</th>
                    <th>Inscrit le</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody id="users-body">
                  <tr><td colspan="5" class="empty">Chargement...</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <!-- Modal capture d'écran -->
      <div class="modal-overlay" id="modal" onclick="closeModal(event)">
        <div class="modal">
          <h3 style="margin-bottom: 12px; font-size: 0.95rem">
            Capture de paiement Wave
          </h3>
          <img id="modal-img" src="" alt="Capture Wave">
          <input
            class="reject-input"
            id="reject-note"
            type="text"
            placeholder="Raison du rejet (optionnel)"
            style="display: none"
          >
          <div class="modal-actions">
            <button class="btn-sm btn-approve" id="btn-modal-approve">
              ✅ Approuver
            </button>
            <button class="btn-sm btn-reject" id="btn-modal-reject-show">
              ❌ Rejeter
            </button>
            <button class="btn-sm" onclick="closeModal()">Fermer</button>
          </div>
        </div>
      </div>

      <script type="module">
        import { getSession, isAdmin, signOut, supabase } from "/supabase.js";

        let currentRequestId = null;
        let currentUserId = null;

        async function init() {
          const session = await getSession();
          if (!session) {
            window.location.href = "/auth.html";
            return;
          }
          if (!(await isAdmin())) {
            window.location.href = "/index.html";
            return;
          }
          await loadDemandes();
        }

        async function loadDemandes() {
          const { data, error } = await supabase
            .from("payment_requests")
            .select(`
            id, screenshot_url, statut, note_admin, created_at,
            profiles:user_id (id, telephone, nom_complet)
          `)
            .order("created_at", { ascending: false });

          const tbody = document.getElementById("demandes-body");
          if (error || !data?.length) {
            tbody.innerHTML =
              '<tr><td colspan="5" class="empty">Aucune demande pour l\'instant.</td></tr>';
            return;
          }

          const pending = data.filter((d) => d.statut === "pending").length;
          const badge = document.getElementById("badge-count");
          if (pending > 0) {
            badge.textContent = pending;
            badge.style.display = "inline";
          } else {
            badge.style.display = "none";
          }

          tbody.innerHTML = data.map((req) => `
          <tr>
            <td>${req.profiles?.nom_complet || "—"}</td>
            <td>${req.profiles?.telephone || "—"}</td>
            <td>${new Date(req.created_at).toLocaleDateString("fr-FR")}</td>
            <td>
              <span class="badge badge-${req.statut}">
                ${
            req.statut === "pending"
              ? "⏳ En attente"
              : req.statut === "approved"
              ? "✅ Approuvé"
              : "❌ Rejeté"
          }
              </span>
            </td>
            <td>
              <button class="btn-sm btn-view" onclick="viewCapture('${req.id}', '${req.screenshot_url}', '${req.profiles?.id}', '${req.statut}')">
                <i class="fas fa-eye"></i> Voir
              </button>
            </td>
          </tr>
        `).join("");
        }

        async function loadUsers() {
          const { data, error } = await supabase
            .from("profiles")
            .select("*")
            .order("created_at", { ascending: false });

          const tbody = document.getElementById("users-body");
          if (error || !data?.length) {
            tbody.innerHTML =
              '<tr><td colspan="5" class="empty">Aucun utilisateur.</td></tr>';
            return;
          }

          tbody.innerHTML = data.map((user) => `
          <tr>
            <td>${user.nom_complet || "—"}</td>
            <td>${user.telephone}</td>
            <td><span class="badge ${
            user.is_active ? "badge-active" : "badge-inactive"
          }">
              ${user.is_active ? "✅ Actif" : "🔒 Inactif"}
            </span></td>
            <td>${new Date(user.created_at).toLocaleDateString("fr-FR")}</td>
            <td>
              <button class="btn-sm btn-toggle" onclick="toggleUser('${user.id}', ${user.is_active})">
                ${user.is_active ? "Désactiver" : "Activer"}
              </button>
            </td>
          </tr>
        `).join("");
        }

        window.viewCapture = async function (
          reqId,
          screenshotPath,
          userId,
          statut,
        ) {
          currentRequestId = reqId;
          currentUserId = userId;

          const { data } = await supabase.storage
            .from("payment-screenshots")
            .createSignedUrl(screenshotPath, 300);

          document.getElementById("modal-img").src = data?.signedUrl || "";
          document.getElementById("reject-note").style.display = "none";
          document.getElementById("reject-note").value = "";

          const approveBtn = document.getElementById("btn-modal-approve");
          const rejectBtn = document.getElementById("btn-modal-reject-show");

          if (statut !== "pending") {
            approveBtn.style.display = "none";
            rejectBtn.style.display = "none";
          } else {
            approveBtn.style.display = "inline";
            rejectBtn.style.display = "inline";
          }

          document.getElementById("modal").classList.add("open");
        };

        window.closeModal = function (e) {
          if (!e || e.target === document.getElementById("modal")) {
            document.getElementById("modal").classList.remove("open");
          }
        };

        document.getElementById("btn-modal-approve").onclick = async function () {
          const session = await getSession();
          const adminId = session.user.id;

          // Approuver la demande
          await supabase.from("payment_requests").update({
            statut: "approved",
            reviewed_at: new Date().toISOString(),
            reviewed_by: adminId,
          }).eq("id", currentRequestId);

          // Activer le compte utilisateur
          await supabase.from("profiles").update({ is_active: true }).eq(
            "id",
            currentUserId,
          );

          // Créer la souscription
          await supabase.from("subscriptions").insert({
            user_id: currentUserId,
            montant: 2000,
            statut: "active",
            activated_at: new Date().toISOString(),
          });

          document.getElementById("modal").classList.remove("open");
          await loadDemandes();
        };

        document.getElementById("btn-modal-reject-show").onclick =
          async function () {
            const noteInput = document.getElementById("reject-note");
            if (noteInput.style.display === "none") {
              noteInput.style.display = "block";
              this.textContent = "Confirmer le rejet";
              return;
            }

            const session = await getSession();
            const adminId = session.user.id;

            await supabase.from("payment_requests").update({
              statut: "rejected",
              note_admin: noteInput.value || "Capture non valide.",
              reviewed_at: new Date().toISOString(),
              reviewed_by: adminId,
            }).eq("id", currentRequestId);

            document.getElementById("modal").classList.remove("open");
            await loadDemandes();
          };

        window.toggleUser = async function (userId, currentlyActive) {
          await supabase.from("profiles")
            .update({ is_active: !currentlyActive })
            .eq("id", userId);
          await loadUsers();
        };

        window.showPage = function (page) {
          document.querySelectorAll(".page").forEach((p) =>
            p.classList.remove("active")
          );
          document.querySelectorAll(".nav-btn").forEach((b) =>
            b.classList.remove("active")
          );
          document.getElementById(`page-${page}`).classList.add("active");
          document.getElementById(`nav-${page}`).classList.add("active");
          if (page === "utilisateurs") loadUsers();
          if (page === "demandes") loadDemandes();
        };

        window.logout = async function () {
          await signOut();
          window.location.href = "/auth.html";
        };

        init();
      </script>
    </body>
  </html>
  ```

- [ ] **Step 2 : Tester admin.html (après Task 9 — création admin)**

  - Se connecter avec le compte admin
  - Ouvrir admin.html → doit s'afficher (pas de redirect)
  - Vérifier que les demandes s'affichent
  - Cliquer "Voir" sur une demande → modal avec la capture
  - Cliquer "Approuver" → badge disparaît, vérifier dans Supabase que
    `profiles.is_active = true`

---

## Task 8 : Modifier index.html (remplacer auth localStorage)

**Files:**

- Modifier : `index.html`

**Interfaces:**

- Consomme : `checkAccess()`, `signOut()`, `getProfile()` depuis `supabase.js`

- [ ] **Step 1 : Lire le bloc d'authentification actuel dans index.html**

  Ouvrir `index.html` et identifier :
  - Le bloc `<script>` qui gère le localStorage auth (login, register, session
    check)
  - Les variables : `currentUser`, `users`, etc.
  - La fonction qui cache/affiche l'écran de login
  - L'affichage du nom utilisateur dans le header

- [ ] **Step 2 : Ajouter l'import Supabase et la vérification de session**

  En haut du premier `<script>` de `index.html`, ajouter `type="module"` au tag
  script principal, puis ajouter en tout début :

  ```javascript
  import { checkAccess, getProfile, signOut } from "/supabase.js";

  // Vérification d'accès au chargement de la page
  let currentProfile = null;
  checkAccess().then((profile) => {
    if (!profile) return; // redirect déjà déclenché par checkAccess()
    currentProfile = profile;
    // Afficher le nom dans le header si présent
    const nameEl = document.getElementById("userName"); // adapter selon l'ID réel
    if (nameEl) nameEl.textContent = profile.nom_complet || profile.telephone;
    // Masquer l'écran de login et afficher le dashboard
    document.getElementById("loginScreen")?.classList.add("hidden");
    document.getElementById("mainApp")?.classList.remove("hidden");
  });
  ```

  **Note :** les IDs `userName`, `loginScreen`, `mainApp` sont à adapter selon
  les vrais IDs présents dans `index.html`. Lire le fichier avant de modifier.

- [ ] **Step 3 : Remplacer le bouton de déconnexion**

  Trouver la fonction de déconnexion dans `index.html` (ex: `logout()`,
  `handleLogout()`) et la remplacer par :

  ```javascript
  async function logout() {
    await signOut();
    window.location.href = "/auth.html";
  }
  ```

- [ ] **Step 4 : Supprimer le code localStorage auth**

  Supprimer ou commenter les blocs suivants (ne pas supprimer la logique UI
  non-auth) :
  - Initialisation de `users` depuis `localStorage`
  - Fonctions `login()`, `register()`, `checkSession()` basées localStorage
  - Tout accès à `localStorage.getItem('users')`,
    `localStorage.setItem('currentUser', ...)`
  - Le compte admin doit être géré par Supabase Auth, sans mot de passe hardcodé
    dans le dépôt

- [ ] **Step 5 : Tester index.html**

  - Sans session → doit rediriger vers auth.html
  - Avec session active (is_active = true) → dashboard s'affiche normalement
  - Avec session inactive → redirige vers payment.html
  - Bouton déconnexion → redirige vers auth.html

---

## Task 9 : Créer le compte admin et tester le flux complet

**Files:**

- Aucun fichier — actions dans le dashboard Supabase

**Interfaces:**

- Consomme : tout ce qui précède

- [ ] **Step 1 : Créer le compte admin**

  Deux sous-étapes :

  **a) Créer l'utilisateur Auth :** Dans Supabase Dashboard → `Authentication` →
  `Users` → `Add user`
  - Email : `762572877@eautoecole.sn` (ou ton vrai numéro admin)
  - Password : choisir un mot de passe fort
  - Cliquer "Create user"

  **b) Ajouter le rôle admin dans app_metadata :** Dans `Authentication` →
  `Users` → cliquer sur l'utilisateur créé → modifier `app_metadata` :
  ```json
  {
    "role": "admin"
  }
  ```
  Sauvegarder.

- [ ] **Step 2 : Tester le flux complet utilisateur → admin**

  **Flux 1 — Nouveau utilisateur :**
  1. Aller sur auth.html → Inscription → créer un compte test
  2. Vérifier redirect vers payment.html (compte inactif)
  3. Uploader une image factice comme "capture Wave"
  4. Vérifier redirect/message "en attente"
  5. Vérifier dans `Table Editor` → `payment_requests` : ligne avec
     `statut = 'pending'`

  **Flux 2 — Admin valide :**
  1. Se connecter avec le compte admin
  2. Aller sur admin.html
  3. Voir la demande dans la liste
  4. Cliquer "Voir" → ouvrir la capture
  5. Cliquer "Approuver"
  6. Vérifier dans `profiles` : `is_active = true`
  7. Vérifier dans `subscriptions` : ligne avec `statut = 'active'`

  **Flux 3 — Utilisateur validé accède à la plateforme :**
  1. Se reconnecter avec le compte test
  2. Vérifier redirect direct vers index.html (plus de payment.html)
  3. Le dashboard s'affiche normalement

- [ ] **Step 3 : Déployer sur Vercel**

  ```bash
  git add supabase.js auth.html payment.html admin.html index.html
  git commit -m "feat: add Supabase backend (auth, subscriptions, admin panel)"
  git push origin main
  ```

  Vérifier le déploiement sur Vercel → tester les 3 flux sur l'URL de
  production.
