import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
});
const safeName = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'file';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') || '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const service = createClient(supabaseUrl, serviceKey);

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: 'Unauthorized' }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const assignmentId = String(body?.assignmentId || '');
  const action = String(body?.action || '');
  if (!assignmentId) return json({ error: 'assignmentId required' }, 400);

  const { data: allowed, error: accessError } = await userClient.rpc('can_access_assignment', { p_assignment_id: assignmentId });
  if (accessError || allowed !== true) return json({ error: 'Assignment denied' }, 403);

  if (action === 'prepare') {
    const filename = safeName(String(body?.filename || 'file'));
    const mime = String(body?.mimeType || 'application/octet-stream');
    const allowedMime = /^(image\/(jpeg|png|webp|heic|heif)|audio\/(mpeg|mp4|x-m4a|wav|ogg|aac)|video\/(mp4|quicktime|webm)|application\/pdf|text\/plain)$/i.test(mime);
    if (!allowedMime) return json({ error: 'Format non accepté' }, 415);
    const path = `${assignmentId}/${userData.user.id}/${crypto.randomUUID()}-${filename}`;
    const { data, error } = await service.storage.from('instructor-messages').createSignedUploadUrl(path, { upsert: false });
    if (error) return json({ error: error.message }, 400);
    return json({ bucket: 'instructor-messages', path, token: data.token, mimeType: mime });
  }

  if (action === 'view') {
    const path = String(body?.path || '');
    if (!path.startsWith(`${assignmentId}/`)) return json({ error: 'Invalid path' }, 400);
    const { data, error } = await service.storage.from('instructor-messages').createSignedUrl(path, 900);
    if (error) return json({ error: error.message }, 400);
    return json({ url: data.signedUrl, expiresIn: 900 });
  }

  return json({ error: 'Unknown action' }, 400);
});
