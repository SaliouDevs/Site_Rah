# Design — Backend Supabase pour eAutoecole

**Date :** 2026-08-14 **Statut :** Approuvé **Stack :** Vanilla HTML/CSS/JS +
Supabase (Auth, Database, Storage) + Vercel

---

## Contexte

Le site eAutoecole (Auto-École) est actuellement un site statique déployé sur
Vercel avec une authentification localStorage non sécurisée. L'objectif est
d'ajouter un vrai backend Supabase avec :

- Authentification téléphone + mot de passe
- Système d'abonnement à 2 000 FCFA (accès à vie)
- Paiement Wave manuel (upload capture d'écran → validation admin)
- Panel admin pour gérer utilisateurs, paiements et accès

---

## Architecture

```
[Site Vercel HTML/CSS/JS]
        │
        ▼
[Supabase]
  ├── Auth        → inscription/connexion (téléphone + mot de passe)
  ├── Database    → utilisateurs, abonnements, demandes de paiement
  ├── Storage     → captures d'écran Wave
  └── RLS         → sécurité par rôle (user / admin)
```

### Stratégie Auth téléphone (sans SMS)

Supabase Auth nécessite un provider SMS payant pour l'OTP téléphone. On évite ce
coût en utilisant l'email Supabase en interne :

- À l'inscription : `telephone` saisi → email interne =
  `{telephone}@eautoecole.sn`
- L'utilisateur ne voit jamais l'email — il entre uniquement son numéro + mot de
  passe
- Le numéro de téléphone est stocké dans `profiles.telephone` pour l'affichage

---

## Base de données

### Table `profiles`

```sql
id            uuid PRIMARY KEY REFERENCES auth.users(id)
telephone     text UNIQUE NOT NULL
nom_complet   text
role          text NOT NULL DEFAULT 'user'  -- 'user' | 'admin'
is_active     boolean NOT NULL DEFAULT false
created_at    timestamptz DEFAULT now()
```

### Table `subscriptions`

```sql
id            uuid PRIMARY KEY DEFAULT gen_random_uuid()
user_id       uuid NOT NULL REFERENCES profiles(id)
montant       integer NOT NULL DEFAULT 2000
statut        text NOT NULL DEFAULT 'pending'  -- 'pending' | 'active'
created_at    timestamptz DEFAULT now()
activated_at  timestamptz
```

### Table `payment_requests`

```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
user_id         uuid NOT NULL REFERENCES profiles(id)
screenshot_url  text NOT NULL
statut          text NOT NULL DEFAULT 'pending'  -- 'pending' | 'approved' | 'rejected'
note_admin      text
created_at      timestamptz DEFAULT now()
reviewed_at     timestamptz
reviewed_by     uuid REFERENCES profiles(id)
```

### Storage

- **Bucket :** `payment-screenshots` (privé)
- Users : peuvent uploader leurs propres captures
- Admin : peut lire toutes les captures

---

## Sécurité (RLS)

| Table                         | Utilisateur connecté                | Admin                  |
| ----------------------------- | ----------------------------------- | ---------------------- |
| `profiles`                    | SELECT/UPDATE sur son propre profil | SELECT tous            |
| `subscriptions`               | SELECT sur la sienne                | SELECT + UPDATE toutes |
| `payment_requests`            | INSERT + SELECT sur les siennes     | SELECT + UPDATE toutes |
| Storage `payment-screenshots` | INSERT (upload)                     | SELECT (lecture)       |

**Rôle admin :** stocké dans `auth.users.app_metadata.role = 'admin'` — non
modifiable par l'utilisateur. La fonction SQL `is_admin()` lit `app_metadata` et
est utilisée dans les politiques RLS.

---

## Flux utilisateur

```
1. Inscription
   → Saisit téléphone + mot de passe + nom
   → Supabase Auth crée user avec email {tel}@eautoecole.sn
   → Trigger SQL crée profil dans `profiles` (is_active = false)

2. Connexion
   → Saisit téléphone + mot de passe
   → JS reconstruit l'email interne et appelle signInWithPassword
   → Session Supabase stockée

3. Vérification d'accès (index.html au chargement)
   → Session active ?
     ├── Non → redirect auth.html
     ├── Oui + is_active = false → redirect payment.html
     └── Oui + is_active = true → accès normal

4. Paiement
   → Affiche numéro Wave + QR code du gérant
   → Utilisateur paie sur Wave, prend capture
   → Upload capture → Supabase Storage
   → INSERT dans payment_requests (statut = 'pending')
   → Message : "Votre demande est en cours de vérification"

5. Validation admin
   → Admin voit liste des demandes pending dans /admin.html
   → Ouvre capture d'écran
   → Approuve → UPDATE payment_requests (approved) + UPDATE profiles (is_active = true) + INSERT subscriptions (active)
   → Rejette → UPDATE payment_requests (rejected) + note_admin
```

---

## Pages à créer/modifier

### `supabase.js` (nouveau)

- Config Supabase client (URL + anon key)
- Fonctions partagées : `getSession()`, `getProfile()`, `isAdmin()`
- Exporté en module ES6

### `auth.html` (nouveau)

- Onglets : Connexion / Inscription
- Connexion : téléphone + mot de passe
- Inscription : téléphone + mot de passe + nom complet
- Lien "Mot de passe oublié" (reset par email interne)
- Redirect vers index.html après succès

### `payment.html` (nouveau)

- Message d'explication : abonnement à vie 2 000 FCFA
- Numéro Wave du gérant + QR code (image statique)
- Zone upload capture d'écran (drag & drop ou bouton)
- Bouton "Envoyer ma preuve de paiement"
- État de la demande si déjà soumise (en attente / rejeté + raison)

### `admin.html` (nouveau)

- Protégé : accessible uniquement si `role = 'admin'`
- Onglets :
  - **Demandes en attente** : liste avec téléphone, date, bouton voir capture,
    Approuver / Rejeter
  - **Utilisateurs** : liste avec statut, possibilité d'activer/désactiver
    manuellement
  - **Historique** : demandes approuvées/rejetées

### `index.html` (modifier)

- Supprimer toute la logique auth localStorage
- Au chargement : vérifier session Supabase → rediriger si nécessaire
- Afficher nom de l'utilisateur depuis `profiles`
- Bouton déconnexion → `supabase.auth.signOut()`

---

## Variables d'environnement

À définir dans Vercel + dans le code :

```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
```

Comme le site est en HTML vanilla (pas de build), ces valeurs seront écrites
directement dans `supabase.js`. Le `anon key` est public par design — la
sécurité repose sur RLS.

---

## Ordre d'implémentation

1. Créer projet Supabase + configurer Auth (désactiver confirmation email)
2. Créer les tables + politiques RLS
3. Créer le bucket Storage + politiques
4. Écrire `supabase.js`
5. Créer `auth.html`
6. Créer `payment.html`
7. Créer `admin.html`
8. Modifier `index.html` (remplacer auth localStorage)
9. Créer le premier compte admin manuellement via Supabase Dashboard
10. Tester le flux complet
