const DEV_AUTO_LOGIN_DISABLED_KEY = 'devAutoLoginDisabled';

const devStudent = {
  prenom: 'Test',
  telephone: '770000000',
  dateInscription: new Date().toISOString(),
  formule: 'Formule Illimitée',
  prix: 2000,
  status: 'active',
  isDevUser: true
};

export async function requireAuthenticatedUser({ allowAdmin = false, onMaintenance } = {}) {
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

  const isAdmin = window.sbIsAdmin(session.user);
  const settings = {};
  let profile = null;
  try {
    profile = await window.sbGetProfile();
  } catch (error) {
    if (isAdmin || error?.code !== 'PGRST116') throw error;
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

  if (!isAdmin && profile.status === 'pending') {
    await window.sbLogout();
    window.location.replace('auth.html?status=pending');
    return null;
  }

  if (!isAdmin && profile.status === 'blocked') {
    await window.sbLogout();
    window.location.replace('auth.html?status=blocked');
    return null;
  }

  return {
    session,
    user: session.user,
    profile: { ...profile, isAdmin, isSupabaseUser: true },
    settings
  };
}

export async function signInWithIdentifier(identifier, password) {
  const result = await window.sbLogin({ telephone: identifier, password });
  const user = await window.sbGetUser();
  const isAdmin = window.sbIsAdmin(user);
  let profile = null;
  try {
    profile = await window.sbGetProfile();
  } catch (error) {
    if (!isAdmin) throw error;
  }
  const settings = {};
  return { ...result, user, profile, settings, isAdmin };
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
  if (reason === 'profile') return { type: 'error', text: 'Profil utilisateur introuvable. Contactez l’auto-école.' };
  if (params.get('admin') === 'denied') return { type: 'error', text: 'Accès administrateur refusé.' };
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
  if (role === 'admin') {
    return { ...devStudent, prenom: 'Administrateur DEV', isAdmin: true, isDevUser: true };
  }
  if (role === 'student') return { ...devStudent };
  return null;
}

export async function logoutCurrentUser(currentUser) {
  if (currentUser?.isDevUser) {
    sessionStorage.setItem(DEV_AUTO_LOGIN_DISABLED_KEY, 'true');
    window.location.href = 'auth.html';
    return;
  }
  if (window.sbLogout) await window.sbLogout();
  window.location.href = 'auth.html';
}

function hasSupabaseAuth() {
  return typeof window.sbGetSession === 'function'
    && typeof window.sbGetProfile === 'function'
    && typeof window.sbLogout === 'function'
    && typeof window.sbIsAdmin === 'function';
}
