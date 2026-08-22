import { loadAppSettings } from './settings-service.js';
import { claimAccountSession, ensureAccountSession, releaseAccountSession } from './session-service.js';

const DEV_AUTO_LOGIN_DISABLED_KEY = 'devAutoLoginDisabled';

const devStudent = {
  prenom: 'Test',
  telephone: '770000000',
  dateInscription: new Date().toISOString(),
  formule: 'Formule Illimitée',
  prix: 2000,
  status: 'active',
  account_role: 'student',
  isDevUser: true
};

export async function requireAuthenticatedUser({ allowAdmin = false, allowInstructor = false, onMaintenance } = {}) {
  const devUser = resolveLocalDevUser();
  if (devUser) return { user: devUser, profile: devUser, settings: {} };

  if (!hasSupabaseAuth()) {
    window.location.replace('auth.html');
    return null;
  }

  const session = await window.sbGetSession();
  if (!session?.user) {
    window.location.replace('auth.html');
    return null;
  }

  const role = resolveAccountRole(session.user);
  const isAdmin = role === 'admin';
  const isInstructor = role === 'instructor';
  const settings = await loadAppSettings();
  let profile = null;
  try {
    profile = await window.sbGetProfile();
  } catch (error) {
    if ((isAdmin || isInstructor) && error?.code === 'PGRST116') profile = null;
    else if (!isAdmin && !isInstructor) throw error;
  }

  if (!profile && !isAdmin) {
    await window.sbLogout();
    window.location.replace('auth.html?reason=profile');
    return null;
  }

  if (isAdmin && !allowAdmin) {
    window.location.replace('admin.html');
    return null;
  }
  if (isInstructor && !allowInstructor) {
    window.location.replace('instructor.html');
    return null;
  }

  const isStudent = !isAdmin && !isInstructor;
  if (isStudent && profile.status === 'pending') {
    await window.sbLogout();
    window.location.replace('auth.html?status=pending');
    return null;
  }
  if (isStudent && settings.maintenance_enabled) {
    await window.sbLogout();
    if (typeof onMaintenance === 'function') onMaintenance(settings);
    else window.location.replace('auth.html?maintenance=1');
    return null;
  }
  if (isStudent && profile.status === 'blocked') {
    await window.sbLogout();
    window.location.replace('auth.html?status=blocked');
    return null;
  }

  if (isStudent) {
    try {
      await ensureAccountSession(session.user);
    } catch (error) {
      await window.sbLogout().catch(() => {});
      window.location.replace('auth.html?reason=session-replaced');
      return null;
    }
  }

  return {
    session,
    user: session.user,
    profile: {
      ...(profile || {}),
      isAdmin,
      isInstructor,
      isSupabaseUser: true,
      account_role: isAdmin ? 'admin' : isInstructor ? 'instructor' : (profile?.account_role || 'student')
    },
    settings
  };
}

export async function signInWithIdentifier(identifier, password) {
  const result = await window.sbLogin({ telephone: identifier, password });
  const user = await window.sbGetUser();
  const role = resolveAccountRole(user);
  const isAdmin = role === 'admin';
  const isInstructor = role === 'instructor';
  let profile = null;
  try {
    profile = await window.sbGetProfile();
  } catch (error) {
    if (!isAdmin && !isInstructor) throw error;
  }
  const settings = await loadAppSettings({ force: true });

  if (!isAdmin && !isInstructor && profile?.status === 'active' && !settings.maintenance_enabled) {
    await claimAccountSession(user);
  }

  return { ...result, user, profile, settings, role, isAdmin, isInstructor };
}

export async function registerStudent({ prenom, telephone, password, formule, prix }) {
  return window.sbRegister({ prenom, telephone, password, formule, prix });
}

export function resolveAuthMessage() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get('status');
  const reason = params.get('reason');
  if (status === 'pending') return { type: 'warning', text: 'Votre inscription est en attente de validation par l’auto-école.' };
  if (status === 'blocked') return { type: 'error', text: 'Votre compte est actuellement bloqué. Veuillez contacter l’auto-école.' };
  if (reason === 'session-expired') return { type: 'warning', text: 'Votre session a expiré. Reconnectez-vous pour continuer.' };
  if (reason === 'session-replaced') return { type: 'warning', text: 'Ce compte vient d’être connecté sur un autre appareil. Cette session a été fermée automatiquement.' };
  if (reason === 'profile') return { type: 'error', text: 'Profil utilisateur introuvable. Contactez l’auto-école.' };
  if (params.get('admin') === 'denied') return { type: 'error', text: 'Accès administrateur refusé.' };
  if (params.get('instructor') === 'denied') return { type: 'error', text: 'Accès moniteur refusé.' };
  if (params.get('maintenance') === '1') {
    const text = sessionStorage.getItem('maintenance_message') || 'Nous effectuons actuellement des améliorations sur eAutoecole. Merci de réessayer dans quelques instants.';
    sessionStorage.removeItem('maintenance_message');
    return { type: 'warning', text };
  }
  return null;
}

export function resolveLocalDevUser() {
  const host = window.location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '';
  if (!isLocal || !window.DEV_CONFIG?.enabled) return null;
  const params = new URLSearchParams(window.location.search);
  const role = params.get('dev') || window.DEV_CONFIG.role;
  const disabled = sessionStorage.getItem(DEV_AUTO_LOGIN_DISABLED_KEY) === 'true';
  if (disabled || role === 'normal') return null;
  if (role === 'admin') return { ...devStudent, prenom: 'Administrateur DEV', isAdmin: true, account_role: 'admin', isDevUser: true };
  if (role === 'instructor') return { ...devStudent, prenom: 'Moniteur DEV', isInstructor: true, account_role: 'instructor', isDevUser: true };
  if (role === 'student') return { ...devStudent };
  return null;
}

export async function logoutCurrentUser(currentUser) {
  if (currentUser?.isDevUser) {
    sessionStorage.setItem(DEV_AUTO_LOGIN_DISABLED_KEY, 'true');
    window.location.href = 'auth.html';
    return;
  }
  if (!currentUser?.isAdmin && !currentUser?.isInstructor) await releaseAccountSession().catch(() => {});
  if (window.sbLogout) await window.sbLogout();
  window.location.href = 'auth.html';
}

export function resolveAccountRole(user) {
  const role = String(user?.app_metadata?.role || '').toLowerCase();
  if (role === 'admin') return 'admin';
  if (role === 'instructor') return 'instructor';
  return 'student';
}

function hasSupabaseAuth() {
  return typeof window.sbGetSession === 'function'
    && typeof window.sbGetProfile === 'function'
    && typeof window.sbLogout === 'function'
    && typeof window.sbIsAdmin === 'function';
}
