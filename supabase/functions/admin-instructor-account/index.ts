import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
});
const normalizePhone = (value: string) => {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('221')) digits = digits.slice(3);
  return digits;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = req.headers.get('Authorization') || '';
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const service = createClient(url, serviceKey);

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: 'Unauthorized' }, 401);
  const { data: isAdmin, error: adminError } = await userClient.rpc('is_admin');
  if (adminError || isAdmin !== true) return json({ error: 'Admin required' }, 403);

  let payload: any;
  try { payload = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const name = String(payload?.name || '').trim();
  const phone = normalizePhone(String(payload?.phone || ''));
  const password = String(payload?.password || '');
  const schoolId = String(payload?.schoolId || '').trim();
  if (!name || phone.length !== 9 || password.length < 8 || !schoolId) {
    return json({ error: 'Nom, téléphone sénégalais, mot de passe de 8 caractères et auto-école requis' }, 400);
  }

  const { data: school, error: schoolError } = await service.from('driving_schools').select('id,name,status').eq('id', schoolId).eq('status', 'active').maybeSingle();
  if (schoolError || !school) return json({ error: 'Auto-école invalide' }, 400);

  const email = `${phone}@siterah.sn`;
  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { prenom: name, telephone: phone, formule: 'Compte Moniteur', prix: 0 },
    app_metadata: { role: 'instructor' }
  });
  if (createError || !created.user) {
    const message = createError?.message || 'Création impossible';
    return json({ error: /already|registered|exists/i.test(message) ? 'Ce numéro possède déjà un compte.' : message }, 400);
  }

  const { error: profileError } = await service.from('profiles').update({
    prenom: name,
    telephone: phone,
    formule: 'Compte Moniteur',
    prix: 0,
    status: 'active',
    account_role: 'instructor',
    driving_school_id: schoolId
  }).eq('id', created.user.id);

  if (profileError) {
    await service.auth.admin.deleteUser(created.user.id).catch(() => {});
    return json({ error: profileError.message }, 400);
  }

  return json({ success: true, userId: created.user.id, identifier: phone, schoolName: school.name });
});
