# Récupération accès administrateur

Le mot de passe administrateur est géré par Supabase Auth. Il ne doit jamais être stocké dans le code frontend.

Procédure si l’accès admin est perdu :

1. Ouvrir Supabase Dashboard > Authentication > Users.
2. Retrouver le compte administrateur.
3. Réinitialiser le mot de passe depuis Supabase Auth.
4. Vérifier que `app_metadata` contient bien :

```json
{
  "role": "admin"
}
```

L’alias `admin` côté interface ne sert qu’à résoudre l’identifiant de connexion. Le rôle réel reste vérifié avec `app_metadata.role === "admin"`.
