// ================================================================
// supabase.js — Client et helpers pour eAutoecole Dieynaba
// Inclure ce fichier APRÈS le CDN Supabase dans chaque page HTML
// ================================================================

const SUPABASE_URL      = 'https://mhoxpqskssbxuuyzjsqx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ob3hwcXNrc3NieHV1eXpqc3F4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3MDc3NzksImV4cCI6MjEwMjI4Mzc3OX0.psB1yyyAjzPNPsymyxUGiki3mS6CiZd8NKHlnGC0b78';

const { createClient } = window.supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Utilitaire téléphone ─────────────────────────────────────────
function phoneToEmail(telephone) {
    return telephone.replace(/\s/g, '') + '@siterah.sn';
}

function identifierToEmail(identifier) {
    const value = String(identifier || '').trim();
    if (value.includes('@')) return value;
    if (value.toLowerCase() === window.ADMIN_CONFIG?.alias) {
        return window.ADMIN_CONFIG.aliasEmail;
    }
    return phoneToEmail(value);
}

// ── Auth ─────────────────────────────────────────────────────────

async function sbRegister({ prenom = 'Élève', telephone, password, formule = 'Formule Illimitée', prix = 2000 }) {
    const email = phoneToEmail(telephone);
    const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: {
            data: {
                prenom:    prenom || 'Élève',
                telephone: telephone.replace(/\s/g, ''),
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
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
}

async function sbLogout() {
    const { error } = await sb.auth.signOut();
    if (error) throw error;
}

async function sbGetSession() {
    const { data: { session } } = await sb.auth.getSession();
    return session;
}

async function sbGetUser() {
    const { data: { user } } = await sb.auth.getUser();
    return user;
}

// Vérifier si l'utilisateur connecté est admin (via app_metadata — non modifiable par l'utilisateur)
function sbIsAdmin(user) {
    return user?.app_metadata?.role === 'admin';
}

// ── Profil ───────────────────────────────────────────────────────

async function sbGetProfile() {
    const user = await sbGetUser();
    if (!user) return null;
    const { data, error } = await sb
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
    const { data, error } = await sb
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
    const { data, error } = await sb
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
}

// Changer le statut d'un utilisateur (pending / active / blocked)
// Utilise une fonction RPC SECURITY DEFINER côté base de données
async function sbAdminUpdateStatus(userId, newStatus) {
    const { data, error } = await sb.rpc('admin_update_status', {
        target_user_id: userId,
        new_status:     newStatus
    });
    if (error) throw error;
    return data;
}

// Auto-activer le compte après confirmation du paiement Wave
async function sbConfirmPayment() {
    const { error } = await sb.rpc('confirm_payment');
    if (error) throw error;
}

// Admin : réinitialiser le mot de passe d'un utilisateur
async function sbAdminResetPassword(userId, newPassword) {
    const { error } = await sb.rpc('admin_reset_password', {
        target_user_id: userId,
        new_password:   newPassword
    });
    if (error) throw error;
}

// ── Storage (photos de profil) ────────────────────────────────────

async function sbUploadPhoto(file) {
    const user = await sbGetUser();
    if (!user) throw new Error('Non connecté');

    const ext  = file.name.split('.').pop();
    const path = `${user.id}/avatar.${ext}`;

    const { error: uploadError } = await sb.storage
        .from('avatars')
        .upload(path, file, { upsert: true });

    if (uploadError) throw uploadError;

    const { data } = sb.storage.from('avatars').getPublicUrl(path);

    // Mettre à jour le profil avec l'URL publique
    await sbUpdateProfile({ photo_url: data.publicUrl });

    return data.publicUrl;
}

async function sbInvokeAdminAction(action, payload = {}) {
    const { data, error } = await sb.functions.invoke('admin-action', {
        body: { action, payload }
    });
    if (error) throw error;
    if (data && data.success === false) throw new Error(data.message || data.error || 'Action refusée');
    return data;
}

function sbOnAuthStateChange(callback) {
    return sb.auth.onAuthStateChange(callback);
}

function sbSubscribe(channelName, config, callback) {
    return sb.channel(channelName).on('postgres_changes', config, callback).subscribe();
}

function sbRemoveChannel(channel) {
    return sb.removeChannel(channel);
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

window.sb = sb;
window.phoneToEmail = phoneToEmail;
window.identifierToEmail = identifierToEmail;
window.sbRegister = sbRegister;
window.sbLogin = sbLogin;
window.sbLogout = sbLogout;
window.sbGetSession = sbGetSession;
window.sbGetUser = sbGetUser;
window.sbIsAdmin = sbIsAdmin;
window.sbGetProfile = sbGetProfile;
window.sbUpdateProfile = sbUpdateProfile;
window.sbGetAllProfiles = sbGetAllProfiles;
window.sbAdminUpdateStatus = sbAdminUpdateStatus;
window.sbConfirmPayment = sbConfirmPayment;
window.sbAdminResetPassword = sbAdminResetPassword;
window.sbUploadPhoto = sbUploadPhoto;
window.sbInvokeAdminAction = sbInvokeAdminAction;
window.sbOnAuthStateChange = sbOnAuthStateChange;
window.sbSubscribe = sbSubscribe;
window.sbRemoveChannel = sbRemoveChannel;
window.requireAuth = requireAuth;
window.requireAdmin = requireAdmin;
