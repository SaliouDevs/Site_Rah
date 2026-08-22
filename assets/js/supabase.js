// ================================================================
// supabase.js — Client et helpers pour eAutoecole
// Inclure ce fichier APRÈS le CDN Supabase dans chaque page HTML
// ================================================================

const SUPABASE_PRODUCTION_URL = 'https://mhoxpqskssbxuuyzjsqx.supabase.co';
const SUPABASE_PRODUCTION_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXAiLCJyZWYiOiJtaG94cHFza3NzYnh1dXl6anNxeCIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzg2NzA3Nzc5LCJleHAiOjIxMDIyODM3Nzl9.INVALID_REPLACED';
const SUPABASE_LOCAL_URL = 'http://127.0.0.1:54321';
const SUPABASE_LOCAL_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const isLocalFrontendHost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
const SUPABASE_URL = isLocalFrontendHost ? SUPABASE_LOCAL_URL : SUPABASE_PRODUCTION_URL;
const SUPABASE_ANON_KEY = isLocalFrontendHost ? SUPABASE_LOCAL_ANON_KEY : SUPABASE_PRODUCTION_ANON_KEY;

const { createClient } = window.supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

function phoneToEmail(telephone) { return telephone.replace(/\s/g, '') + '@siterah.sn'; }
function identifierToEmail(identifier) {
    const value = String(identifier || '').trim();
    if (value.toLowerCase() === window.ADMIN_CONFIG?.alias) return window.ADMIN_CONFIG.aliasEmail;
    if (value.includes('@')) return value;
    return phoneToEmail(value);
}

async function sbRegister({ prenom = 'Élève', telephone, password, formule = 'Formule Illimitée', prix = 2000 }) {
    const cleanPhone = telephone.replace(/\s/g, '');
    const { data, error } = await supabaseClient.auth.signUp({
        email: phoneToEmail(cleanPhone), password,
        options: { data: { prenom: prenom || 'Élève', telephone: cleanPhone, formule, prix } }
    });
    if (error) throw error;
    return data;
}
async function sbLogin({ telephone, password }) {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email: identifierToEmail(telephone), password });
    if (error) throw error;
    return data;
}
async function sbLogout() {
    const { error } = await supabaseClient.auth.signOut({ scope: 'local' });
    if (error) throw error;
}
async function sbGetSession() {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    return session;
}
async function sbGetUser() {
    const session = await sbGetSession();
    if (session?.user) return session.user;
    const { data: { user } } = await supabaseClient.auth.getUser();
    return user;
}
async function sbRefreshSession() {
    const { data, error } = await supabaseClient.auth.refreshSession();
    if (error) throw error;
    return data.session;
}
function sbIsAdmin(user) { return user?.app_metadata?.role === 'admin'; }

async function sbGetProfile() {
    const user = await sbGetUser();
    if (!user) return null;
    const { data, error } = await supabaseClient.from('profiles').select('*').eq('id', user.id).single();
    if (error) throw error;
    return data;
}
async function sbUpdateProfile(updates) {
    const user = await sbGetUser();
    if (!user) throw new Error('Non connecté');
    const { data, error } = await supabaseClient.from('profiles').update(updates).eq('id', user.id).select().single();
    if (error) throw error;
    return data;
}
async function sbGetAllProfiles() {
    const { data, error } = await supabaseClient.from('profiles').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data;
}
async function sbGetProfilesPage({ page = 1, pageSize = 10, status = 'all', query = '' } = {}) {
    const from = Math.max(0, (Number(page) || 1) - 1) * pageSize;
    const to = from + pageSize - 1;
    let request = supabaseClient.from('profiles').select('*', { count: 'exact' }).order('created_at', { ascending: false });
    if (status && status !== 'all') request = request.eq('status', status);
    const cleanQuery = String(query || '').trim();
    if (cleanQuery) {
        const term = cleanQuery.replace(/[%_,]/g, '');
        request = request.or(`prenom.ilike.%${term}%,telephone.ilike.%${term}%`);
    }
    const { data, error, count } = await request.range(from, to);
    if (error) throw error;
    return { profiles: data || [], total: count || 0 };
}
async function sbGetProfileCounts() {
    async function count(status) {
        let request = supabaseClient.from('profiles').select('id', { count: 'exact', head: true });
        if (status) request = request.eq('status', status);
        const { error, count: value } = await request;
        if (error) throw error;
        return value || 0;
    }
    const [total, pending, active, blocked] = await Promise.all([count(), count('pending'), count('active'), count('blocked')]);
    return { total, pending, active, blocked };
}
async function sbAdminUpdateStatus(userId, newStatus) {
    const { data, error } = await supabaseClient.rpc('admin_update_status', { target_user_id: userId, new_status: newStatus });
    if (error) throw error;
    return data;
}
async function sbAdminResetPassword(userId, newPassword) {
    const { error } = await supabaseClient.rpc('admin_reset_password', { target_user_id: userId, new_password: newPassword });
    if (error) throw error;
}
async function sbAdminRenameUser(userId, prenom) {
    const { data, error } = await supabaseClient.from('profiles').update({ prenom }).eq('id', userId).select().single();
    if (error) throw error;
    return data;
}
async function sbAdminDeleteUser(userId) {
    const { data, error } = await supabaseClient.rpc('admin_delete_user', { target_user_id: userId });
    if (error) throw error;
    return data;
}

async function sbClaimUserSession(deviceId) {
    const { data, error } = await supabaseClient.rpc('claim_user_session', { p_device_id: deviceId });
    if (error) throw error;
    return Array.isArray(data) ? data[0] : data;
}
async function sbValidateUserSession(deviceId, sessionToken) {
    const { data, error } = await supabaseClient.rpc('validate_user_session', { p_device_id: deviceId, p_session_token: sessionToken });
    if (error) throw error;
    return Boolean(data);
}
async function sbTouchUserSession(deviceId, sessionToken) {
    const { data, error } = await supabaseClient.rpc('touch_user_session', { p_device_id: deviceId, p_session_token: sessionToken });
    if (error) throw error;
    return Boolean(data);
}
async function sbReleaseUserSession(deviceId, sessionToken) {
    const { data, error } = await supabaseClient.rpc('release_user_session', { p_device_id: deviceId, p_session_token: sessionToken });
    if (error) throw error;
    return Boolean(data);
}

async function sbRecordLearningAttempt(payload = {}) {
    const scoreValue = payload.score === null || payload.score === undefined || payload.score === '' ? null : Number(payload.score);
    const { data, error } = await supabaseClient.rpc('record_learning_attempt', {
        p_activity_type: payload.activityType,
        p_activity_key: payload.activityKey,
        p_question_id: payload.questionId || null,
        p_topic: payload.topic || null,
        p_is_correct: typeof payload.isCorrect === 'boolean' ? payload.isCorrect : null,
        p_score: Number.isFinite(scoreValue) ? scoreValue : null,
        p_metadata: payload.metadata || {}
    });
    if (error) throw error;
    return data;
}
async function sbAwardLearningPoints({ sourceKey, kind, points, metadata = {} }) {
    const { data, error } = await supabaseClient.rpc('award_learning_points', { p_source_key: sourceKey, p_kind: kind, p_points: points, p_metadata: metadata });
    if (error) throw error;
    return Number(data || 0);
}
async function sbGetLearningDashboard() {
    const { data, error } = await supabaseClient.rpc('get_learning_dashboard');
    if (error) throw error;
    return data || { points: 0, attempts: 0, answered: 0, correct: 0, weakTopics: [] };
}
async function sbGetLearningProfile() {
    const user = await sbGetUser();
    if (!user) return null;
    const { data, error } = await supabaseClient.from('student_learning_profiles').select('*').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    return data;
}
async function sbUpsertLearningProfile(updates = {}) {
    const user = await sbGetUser();
    if (!user) throw new Error('Non connecté');
    const { data, error } = await supabaseClient.from('student_learning_profiles')
        .upsert({ user_id: user.id, ...updates, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }).select().single();
    if (error) throw error;
    return data;
}

async function sbUploadPhoto(file) {
    const user = await sbGetUser();
    if (!user) throw new Error('Non connecté');
    const ext = file.name.split('.').pop();
    const path = `${user.id}/avatar.${ext}`;
    const { error: uploadError } = await supabaseClient.storage.from('avatars').upload(path, file, { upsert: true });
    if (uploadError) throw uploadError;
    const { data } = supabaseClient.storage.from('avatars').getPublicUrl(path);
    await sbUpdateProfile({ photo_url: data.publicUrl });
    return data.publicUrl;
}
async function sbInvokeAdminAction(action, payload = {}) {
    const { data, error } = await supabaseClient.functions.invoke('admin-action', { body: { action, payload } });
    if (error) throw error;
    if (data && data.success === false) throw new Error(data.message || data.error || 'Action refusée');
    return data;
}
function sbOnAuthStateChange(callback) { return supabaseClient.auth.onAuthStateChange(callback); }
function sbSubscribe(channelName, config, callback) { return supabaseClient.channel(channelName).on('postgres_changes', config, callback).subscribe(); }
function sbRemoveChannel(channel) { return supabaseClient.removeChannel(channel); }
async function requireAuth() {
    const session = await sbGetSession();
    if (!session) { window.location.href = 'auth.html'; return null; }
    return session;
}
async function requireAdmin() {
    const session = await sbGetSession();
    if (!session) { window.location.href = 'auth.html'; return null; }
    if (!sbIsAdmin(session.user)) { window.location.href = 'index.html'; return null; }
    return session;
}

Object.assign(window, {
    sb: supabaseClient, phoneToEmail, identifierToEmail, sbRegister, sbLogin, sbLogout,
    sbGetSession, sbGetUser, sbRefreshSession, sbIsAdmin, sbGetProfile, sbUpdateProfile,
    sbGetAllProfiles, sbGetProfilesPage, sbGetProfileCounts, sbAdminUpdateStatus,
    sbAdminResetPassword, sbAdminRenameUser, sbAdminDeleteUser,
    sbClaimUserSession, sbValidateUserSession, sbTouchUserSession, sbReleaseUserSession,
    sbRecordLearningAttempt, sbAwardLearningPoints, sbGetLearningDashboard,
    sbGetLearningProfile, sbUpsertLearningProfile, sbUploadPhoto, sbInvokeAdminAction,
    sbOnAuthStateChange, sbSubscribe, sbRemoveChannel, requireAuth, requireAdmin
});
