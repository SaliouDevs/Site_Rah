// ================================================================
// supabase.js — Client et helpers pour eAutoecole
// Inclure ce fichier APRÈS le CDN Supabase dans chaque page HTML
// ================================================================

const SUPABASE_PRODUCTION_URL = 'https://mhoxpqskssbxuuyzjsqx.supabase.co';
const SUPABASE_PRODUCTION_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ob3hwcXNrc3NieHV1eXpqc3F4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3MDc3NzksImV4cCI6MjEwMjI4Mzc3OX0.psB1yyyAjzPNPsymyxUGiki3mS6CiZd8NKHlnGC0b78';
const SUPABASE_LOCAL_URL = 'http://127.0.0.1:54321';
const SUPABASE_LOCAL_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const isLocalFrontendHost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
const SUPABASE_URL = isLocalFrontendHost ? SUPABASE_LOCAL_URL : SUPABASE_PRODUCTION_URL;
const SUPABASE_ANON_KEY = isLocalFrontendHost ? SUPABASE_LOCAL_ANON_KEY : SUPABASE_PRODUCTION_ANON_KEY;

const { createClient } = window.supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
    }
});

// ── Utilitaire téléphone ─────────────────────────────────────────
function phoneToEmail(telephone) {
    return telephone.replace(/\s/g, '') + '@siterah.sn';
}

function identifierToEmail(identifier) {
    const value = String(identifier || '').trim();
    if (value.toLowerCase() === window.ADMIN_CONFIG?.alias) {
        return window.ADMIN_CONFIG.aliasEmail;
    }
    if (value.includes('@')) return value;
    return phoneToEmail(value);
}

// ── Auth ─────────────────────────────────────────────────────────

async function sbRegister({ prenom = 'Élève', telephone, password, formule = 'Formule Illimitée', prix = 2000 }) {
    const cleanPhone = telephone.replace(/\s/g, '');
    const email = phoneToEmail(cleanPhone);
    const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: {
            data: {
                prenom:    prenom || 'Élève',
                telephone: cleanPhone,
                formule,
                prix
            }
        }
    });
    if (error) throw error;
    return data;
}

async function sbLogin({ telephone, password }) {
    const email = identifierToEmail(telephone);
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
}

async function sbLogout() {
    const { error } = await supabaseClient.auth.signOut();
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

// Vérifier si l'utilisateur connecté est admin (via app_metadata — non modifiable par l'utilisateur)
function sbIsAdmin(user) {
    return user?.app_metadata?.role === 'admin';
}

// ── Profil ───────────────────────────────────────────────────────

async function sbGetProfile() {
    const user = await sbGetUser();
    if (!user) return null;
    const { data, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
    if (error) throw error;
    return data;
}

async function sbUpdateProfile(updates) {
    const user = await sbGetUser();
    if (!user) throw new Error('Non connecté');
    const { data, error } = await supabaseClient
        .from('profiles')
        .update(updates)
        .eq('id', user.id)
        .select()
        .single();
    if (error) throw error;
    return data;
}

// ── Admin ─────────────────────────────────────────────────────────

async function sbGetAllProfiles() {
    const { data, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
}

async function sbGetProfilesPage({ page = 1, pageSize = 10, status = 'all', query = '' } = {}) {
    const from = Math.max(0, (Number(page) || 1) - 1) * pageSize;
    const to = from + pageSize - 1;
    let request = supabaseClient
        .from('profiles')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });
    if (status && status !== 'all') {
        request = request.eq('status', status);
    }
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
    const [total, pending, active, blocked] = await Promise.all([
        count(),
        count('pending'),
        count('active'),
        count('blocked')
    ]);
    return { total, pending, active, blocked };
}

// Changer le statut d'un utilisateur (pending / active / blocked)
// Utilise une fonction RPC SECURITY DEFINER côté base de données
async function sbAdminUpdateStatus(userId, newStatus) {
    const { data, error } = await supabaseClient.rpc('admin_update_status', {
        target_user_id: userId,
        new_status:     newStatus
    });
    if (error) throw error;
    return data;
}

// Auto-activer le compte après confirmation du paiement Wave
async function sbConfirmPayment() {
    const { error } = await supabaseClient.rpc('confirm_payment');
    if (error) throw error;
}

// Admin : réinitialiser le mot de passe d'un utilisateur
async function sbAdminResetPassword(userId, newPassword) {
    const { error } = await supabaseClient.rpc('admin_reset_password', {
        target_user_id: userId,
        new_password:   newPassword
    });
    if (error) throw error;
}

async function sbAdminRenameUser(userId, prenom) {
    const { data, error } = await supabaseClient
        .from('profiles')
        .update({ prenom })
        .eq('id', userId)
        .select()
        .single();
    if (error) throw error;
    return data;
}

// ── Storage (photos de profil) ────────────────────────────────────

async function sbUploadPhoto(file) {
    const user = await sbGetUser();
    if (!user) throw new Error('Non connecté');

    const ext  = file.name.split('.').pop();
    const path = `${user.id}/avatar.${ext}`;

    const { error: uploadError } = await supabaseClient.storage
        .from('avatars')
        .upload(path, file, { upsert: true });

    if (uploadError) throw uploadError;

    const { data } = supabaseClient.storage.from('avatars').getPublicUrl(path);

    // Mettre à jour le profil avec l'URL publique
    await sbUpdateProfile({ photo_url: data.publicUrl });

    return data.publicUrl;
}

async function sbInvokeAdminAction(action, payload = {}) {
    // V3.2 / future admin features: kept for the inactive Control Center only.
    const { data, error } = await supabaseClient.functions.invoke('admin-action', {
        body: { action, payload }
    });
    if (error) throw error;
    if (data && data.success === false) throw new Error(data.message || data.error || 'Action refusée');
    return data;
}

function sbOnAuthStateChange(callback) {
    return supabaseClient.auth.onAuthStateChange(callback);
}

function sbSubscribe(channelName, config, callback) {
    return supabaseClient.channel(channelName).on('postgres_changes', config, callback).subscribe();
}

function sbRemoveChannel(channel) {
    return supabaseClient.removeChannel(channel);
}

// ── Guards de navigation ──────────────────────────────────────────

// Redirige vers auth.html si pas de session, sinon retourne la session
async function requireAuth() {
    const session = await sbGetSession();
    if (!session) {
        window.location.href = 'auth.html';
        return null;
    }
    return session;
}

// Redirige vers auth.html si pas de session, ou vers index.html si pas admin
async function requireAdmin() {
    const session = await sbGetSession();
    if (!session) {
        window.location.href = 'auth.html';
        return null;
    }
    if (!sbIsAdmin(session.user)) {
        window.location.href = 'index.html';
        return null;
    }
    return session;
}

window.sb = supabaseClient;
window.phoneToEmail = phoneToEmail;
window.identifierToEmail = identifierToEmail;
window.sbRegister = sbRegister;
window.sbLogin = sbLogin;
window.sbLogout = sbLogout;
window.sbGetSession = sbGetSession;
window.sbGetUser = sbGetUser;
window.sbRefreshSession = sbRefreshSession;
window.sbIsAdmin = sbIsAdmin;
window.sbGetProfile = sbGetProfile;
window.sbUpdateProfile = sbUpdateProfile;
window.sbGetAllProfiles = sbGetAllProfiles;
window.sbGetProfilesPage = sbGetProfilesPage;
window.sbGetProfileCounts = sbGetProfileCounts;
window.sbAdminUpdateStatus = sbAdminUpdateStatus;
window.sbConfirmPayment = sbConfirmPayment;
window.sbAdminResetPassword = sbAdminResetPassword;
window.sbAdminRenameUser = sbAdminRenameUser;
window.sbUploadPhoto = sbUploadPhoto;
window.sbInvokeAdminAction = sbInvokeAdminAction;
window.sbOnAuthStateChange = sbOnAuthStateChange;
window.sbSubscribe = sbSubscribe;
window.sbRemoveChannel = sbRemoveChannel;
window.requireAuth = requireAuth;
window.requireAdmin = requireAdmin;
