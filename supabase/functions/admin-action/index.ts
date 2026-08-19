import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.0';

type ActionBody = {
  action?: string;
  payload?: Record<string, unknown>;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'method_not_allowed', message: 'Méthode non autorisée' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return json({ success: false, error: 'server_config_missing', message: 'Configuration serveur manquante' }, 500);
  }

  const authHeader = req.headers.get('Authorization') || '';
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const adminClient = createClient(supabaseUrl, serviceKey);

  const { data: userData, error: userError } = await userClient.auth.getUser();
  const actor = userData?.user;
  if (userError || !actor) {
    await logSecurity(adminClient, null, 'unauthorized_admin_action', 'important', { reason: 'missing_session' });
    return json({ success: false, error: 'unauthorized', message: 'Session requise' }, 401);
  }
  if (actor.app_metadata?.role !== 'admin') {
    await logSecurity(adminClient, actor.id, 'invalid_role_access', 'important', {});
    return json({ success: false, error: 'admin_required', message: 'Accès administrateur refusé' }, 403);
  }

  let body: ActionBody;
  try {
    body = await req.json();
  } catch (_error) {
    return json({ success: false, error: 'invalid_json', message: 'Requête invalide' }, 400);
  }

  try {
    const data = await handleAction(adminClient, actor.id, body.action || '', body.payload || {});
    return json({ success: true, data });
  } catch (error) {
    return json({ success: false, error: 'action_failed', message: error instanceof Error ? error.message : 'Action impossible' }, 400);
  }
});

async function handleAction(sb: any, actorId: string, action: string, payload: Record<string, unknown>) {
  if (action === 'overview') {
    const [profiles, settings, notifications, auditLogs, securityEvents] = await Promise.all([
      sb.from('profiles').select('*').order('created_at', { ascending: false }),
      sb.from('app_settings').select('*').eq('id', 'global').single(),
      sb.from('user_notifications').select('*').order('created_at', { ascending: false }).limit(50),
      sb.from('admin_audit_logs').select('*').order('created_at', { ascending: false }).limit(80),
      sb.from('security_events').select('*').order('created_at', { ascending: false }).limit(80)
    ]);
    throwIf(profiles.error || settings.error || notifications.error || auditLogs.error || securityEvents.error);
    return {
      profiles: profiles.data || [],
      settings: settings.data,
      notifications: notifications.data || [],
      auditLogs: auditLogs.data || [],
      securityEvents: securityEvents.data || []
    };
  }

  if (action === 'update-user-status') {
    const userId = requiredString(payload.userId, 'userId');
    const status = requiredString(payload.status, 'status');
    if (!['pending', 'active', 'blocked'].includes(status)) throw new Error('Statut invalide');
    const { data, error } = await sb.from('profiles').update({ status, updated_at: new Date().toISOString() }).eq('id', userId).select().single();
    throwIf(error);
    await audit(sb, actorId, status === 'blocked' ? 'user_blocked' : status === 'active' ? 'user_validated' : 'user_pending', userId, { status });
    return data;
  }

  if (action === 'rename-user') {
    const userId = requiredString(payload.userId, 'userId');
    const prenom = requiredString(payload.prenom, 'prenom').slice(0, 80);
    const { data, error } = await sb.from('profiles').update({ prenom, updated_at: new Date().toISOString() }).eq('id', userId).select().single();
    throwIf(error);
    await audit(sb, actorId, 'user_renamed', userId, {});
    return data;
  }

  if (action === 'reset-password') {
    const userId = requiredString(payload.userId, 'userId');
    const password = requiredString(payload.password, 'password');
    if (password.length < 6) throw new Error('Minimum 6 caractères');
    const { error } = await sb.auth.admin.updateUserById(userId, { password });
    throwIf(error);
    await audit(sb, actorId, 'user_password_reset', userId, {});
    return { userId };
  }

  if (action === 'delete-user') {
    const userId = requiredString(payload.userId, 'userId');
    if (userId === actorId) throw new Error('Impossible de supprimer le compte administrateur connecté');
    await audit(sb, actorId, 'user_deleted', userId, {});
    const { error } = await sb.auth.admin.deleteUser(userId);
    throwIf(error);
    return { userId };
  }

  if (action === 'force-user-logout') {
    const userId = requiredString(payload.userId, 'userId');
    const invalidBefore = new Date().toISOString();
    const { error } = await sb.from('profiles').update({ session_invalid_before: invalidBefore }).eq('id', userId);
    throwIf(error);
    await audit(sb, actorId, 'user_forced_logout', userId, {});
    return { userId, session_invalid_before: invalidBefore };
  }

  if (action === 'force-students-logout') {
    if (payload.confirm !== 'DECONNECTER') throw new Error('Confirmation invalide');
    const invalidBefore = new Date().toISOString();
    const { error } = await sb.from('app_settings').update({ session_invalid_before: invalidBefore, updated_at: invalidBefore, updated_by: actorId }).eq('id', 'global');
    throwIf(error);
    await audit(sb, actorId, 'global_force_logout', null, {});
    return { session_invalid_before: invalidBefore };
  }

  if (action === 'update-app-settings') {
    const settings = sanitizeSettings(payload.settings || {});
    const { data, error } = await sb.from('app_settings').update({ ...settings, updated_at: new Date().toISOString(), updated_by: actorId }).eq('id', 'global').select().single();
    throwIf(error);
    await audit(sb, actorId, settings.maintenance_enabled ? 'maintenance_enabled' : 'app_settings_updated', null, { keys: Object.keys(settings) });
    return data;
  }

  if (action === 'send-notification') {
    const notification = sanitizeNotification(payload.notification || {}, actorId);
    const { data, error } = await sb.from('user_notifications').insert(notification).select().single();
    throwIf(error);
    await audit(sb, actorId, 'notification_sent', notification.target_user_id || null, { type: notification.type });
    return data;
  }

  throw new Error('Action inconnue');
}

function sanitizeSettings(input: Record<string, unknown>) {
  const bool = (value: unknown) => value === true || value === 'true';
  return {
    maintenance_enabled: bool(input.maintenance_enabled),
    maintenance_title: string(input.maintenance_title, 'Maintenance en cours').slice(0, 120),
    maintenance_message: string(input.maintenance_message, '').slice(0, 1200),
    maintenance_until: nullableDate(input.maintenance_until),
    school_name: string(input.school_name, 'Auto-école').slice(0, 120),
    support_phone: string(input.support_phone, '77 583 20 37').slice(0, 40),
    whatsapp_phone: string(input.whatsapp_phone, '221775832037').slice(0, 40),
    support_email: string(input.support_email, 'eautoecole1@gmail.com').slice(0, 120),
    examen_poids_leger_enabled: bool(input.examen_poids_leger_enabled),
    examen_poids_lourd_enabled: bool(input.examen_poids_lourd_enabled),
    announcement_title: string(input.announcement_title, '').slice(0, 120),
    announcement_message: string(input.announcement_message, '').slice(0, 500),
    announcement_expires_at: nullableDate(input.announcement_expires_at)
  };
}

function sanitizeNotification(input: Record<string, unknown>, actorId: string) {
  const type = ['information', 'important', 'maintenance', 'success'].includes(String(input.type)) ? String(input.type) : 'information';
  return {
    target_user_id: input.target_user_id ? String(input.target_user_id) : null,
    title: requiredString(input.title, 'title').slice(0, 120),
    message: requiredString(input.message, 'message').slice(0, 1200),
    type,
    requires_ack: input.requires_ack === true || input.requires_ack === 'true',
    starts_at: nullableDate(input.starts_at) || new Date().toISOString(),
    expires_at: nullableDate(input.expires_at),
    created_by: actorId
  };
}

async function audit(sb: any, actorUserId: string, action: string, targetUserId: string | null, metadata: Record<string, unknown>) {
  const { error } = await sb.from('admin_audit_logs').insert({ actor_user_id: actorUserId, action, target_user_id: targetUserId, metadata });
  throwIf(error);
}

async function logSecurity(sb: any, userId: string | null, eventType: string, severity: string, metadata: Record<string, unknown>) {
  await sb.from('security_events').insert({ user_id: userId, event_type: eventType, severity, source: 'server', metadata });
}

function requiredString(value: unknown, name: string) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${name} requis`);
  return text;
}

function string(value: unknown, fallback: string) {
  return String(value ?? fallback).trim();
}

function nullableDate(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function throwIf(error: unknown) {
  if (error) throw error;
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
