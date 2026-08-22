const { execFileSync, execSync } = require('child_process');

const ROOT = process.cwd();
const ADMIN_ALIAS = 'rah@admin';
const ADMIN_PHONE = '762572877';
const STUDENT_PHONE = '770000001';
const EMAIL_DOMAIN = 'siterah.sn';
const LOCAL_DB_CONTAINER = 'supabase_db_Testrah';

function getRequiredPassword() {
  const password = process.env.EAUTO_LOCAL_DEV_PASSWORD;
  if (!password || password.length < 6) {
    throw new Error('Set EAUTO_LOCAL_DEV_PASSWORD to a local dev password with at least 6 characters.');
  }
  return password;
}

function readLocalSupabaseConfig() {
  const raw = execSync('npx supabase status -o json', {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const config = JSON.parse(raw);
  assertLocalUrl(config.API_URL);
  return {
    url: config.API_URL,
    serviceKey: config.SERVICE_ROLE_KEY || config.SECRET_KEY
  };
}

function assertLocalUrl(value) {
  const url = new URL(value);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error(`Refusing non-local Supabase URL: ${value}`);
  }
}

function phoneToEmail(phone) {
  return `${phone}@${EMAIL_DOMAIN}`;
}

function runLocalSql(sql) {
  execFileSync('docker', ['exec', LOCAL_DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function ensureProfilesSchema() {
  runLocalSql(`
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  prenom text not null default 'Eleve',
  telephone text unique not null,
  formule text not null default 'Formule Illimitee',
  prix integer not null default 2000,
  status text not null default 'pending' check (status in ('pending', 'active', 'blocked')),
  photo_url text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "select_own_or_admin" on public.profiles;
create policy "select_own_or_admin" on public.profiles for select to authenticated
  using ((select auth.uid()) = id or (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "update_own_profile" on public.profiles;
create policy "update_own_profile" on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
revoke update on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (prenom, photo_url) on public.profiles to authenticated;
grant select, insert, update, delete on public.profiles to service_role;
create or replace function public.admin_update_status(target_user_id uuid, new_status text)
returns json language plpgsql security definer set search_path = public as $$
declare result json;
begin
  if (select auth.jwt() -> 'app_metadata' ->> 'role') <> 'admin' then
    raise exception 'Acces refuse';
  end if;
  if new_status not in ('pending', 'active', 'blocked') then
    raise exception 'Statut invalide';
  end if;
  update public.profiles set status = new_status where id = target_user_id
  returning row_to_json(profiles.*) into result;
  return result;
end;
$$;
revoke execute on function public.admin_update_status(uuid, text) from public;
grant execute on function public.admin_update_status(uuid, text) to authenticated;
notify pgrst, 'reload schema';
`);
}

async function localFetch(config, pathName, options = {}) {
  const response = await fetch(`${config.url}${pathName}`, {
    ...options,
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {}
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${pathName} failed with ${response.status}: ${text}`);
  }
  return json;
}

async function findAuthUser(config, email) {
  const listed = await localFetch(config, '/auth/v1/admin/users');
  const users = listed?.users || listed || [];
  return users.find((user) => user.email === email) || null;
}

async function upsertAuthUser(config, { email, password, role, prenom, telephone }) {
  const existing = await findAuthUser(config, email);
  const payload = {
    email,
    password,
    email_confirm: true,
    app_metadata: role ? { role } : {},
    user_metadata: {
      prenom,
      telephone,
      formule: 'Formule Illimitee',
      prix: 2000
    }
  };
  if (existing?.id) {
    return localFetch(config, `/auth/v1/admin/users/${existing.id}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  }
  return localFetch(config, '/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

async function upsertProfile(config, { id, prenom, telephone }) {
  await localFetch(config, '/rest/v1/profiles', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      id,
      prenom,
      telephone,
      formule: 'Formule Illimitee',
      prix: 2000,
      status: 'active'
    })
  });
  await localFetch(config, `/rest/v1/profiles?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ prenom, telephone, status: 'active' })
  });
}

async function readProfile(config, id) {
  const rows = await localFetch(config, `/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=id,prenom,telephone,status`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function setupUser(config, { phone, role, prenom, password }) {
  const email = phoneToEmail(phone);
  const authUser = await upsertAuthUser(config, { email, password, role, prenom, telephone: phone });
  await upsertProfile(config, { id: authUser.id, prenom, telephone: phone });
  const profile = await readProfile(config, authUser.id);
  return {
    id: authUser.id,
    email,
    role: authUser.app_metadata?.role || '',
    profileStatus: profile?.status || ''
  };
}

(async () => {
  const password = getRequiredPassword();
  const config = readLocalSupabaseConfig();
  ensureProfilesSchema();

  const admin = await setupUser(config, {
    phone: ADMIN_PHONE,
    role: 'admin',
    prenom: 'Admin DEV',
    password
  });
  const student = await setupUser(config, {
    phone: STUDENT_PHONE,
    role: '',
    prenom: 'Student DEV',
    password
  });

  if (admin.email !== phoneToEmail(ADMIN_PHONE) || admin.role !== 'admin' || admin.profileStatus !== 'active') {
    throw new Error('Admin local auth setup verification failed.');
  }
  if (student.profileStatus !== 'active') {
    throw new Error('Student local auth setup verification failed.');
  }

  console.log(JSON.stringify({
    supabaseUrl: config.url,
    admin: {
      alias: ADMIN_ALIAS,
      email: admin.email,
      role: admin.role,
      profileStatus: admin.profileStatus
    },
    student: {
      email: student.email,
      profileStatus: student.profileStatus
    }
  }, null, 2));
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
