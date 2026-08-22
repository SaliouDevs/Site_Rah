const DEVICE_KEY = 'eautoecole.deviceId';
const SESSION_PREFIX = 'eautoecole.accountSession.';

function uuid() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `dev-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = uuid();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

function tokenKey(userId) { return `${SESSION_PREFIX}${userId}`; }
export function getAccountSessionToken(userId) { return userId ? localStorage.getItem(tokenKey(userId)) : null; }
function saveAccountSessionToken(userId, token) { if (userId && token) localStorage.setItem(tokenKey(userId), token); }
function clearAccountSessionToken(userId) { if (userId) localStorage.removeItem(tokenKey(userId)); }

export async function claimAccountSession(user) {
  if (!user || window.sbIsAdmin?.(user)) return null;
  if (typeof window.sbClaimUserSession !== 'function') return null;
  const row = await window.sbClaimUserSession(getDeviceId());
  const token = row?.session_token || row?.sessionToken;
  if (!token) throw new Error('Session unique non initialisée');
  saveAccountSessionToken(user.id, token);
  return { deviceId: getDeviceId(), token };
}

export async function ensureAccountSession(user) {
  if (!user || window.sbIsAdmin?.(user)) return true;
  if (typeof window.sbValidateUserSession !== 'function') return true;
  const deviceId = getDeviceId();
  const token = getAccountSessionToken(user.id);
  if (!token) {
    const claimed = await claimAccountSession(user);
    return Boolean(claimed?.token);
  }
  const valid = await window.sbValidateUserSession(deviceId, token);
  if (!valid) {
    clearAccountSessionToken(user.id);
    throw new Error('SESSION_REPLACED');
  }
  return true;
}

export async function releaseAccountSession(user = null) {
  const currentUser = user || await window.sbGetUser?.();
  if (!currentUser || window.sbIsAdmin?.(currentUser)) return false;
  const deviceId = getDeviceId();
  const token = getAccountSessionToken(currentUser.id);
  clearAccountSessionToken(currentUser.id);
  if (!token || typeof window.sbReleaseUserSession !== 'function') return false;
  return window.sbReleaseUserSession(deviceId, token);
}

export function startAccountSessionGuard({ user, onReplaced } = {}) {
  if (!user || window.sbIsAdmin?.(user)) return () => {};
  const deviceId = getDeviceId();
  let stopped = false;
  let channel = null;
  let interval = null;
  let checking = false;

  const invalidate = async () => {
    if (stopped) return;
    stopped = true;
    clearAccountSessionToken(user.id);
    try { await window.sbLogout?.(); } catch (_) {}
    if (typeof onReplaced === 'function') onReplaced();
    else window.location.replace('auth.html?reason=session-replaced');
  };

  const check = async ({ touch = false } = {}) => {
    if (stopped || checking) return;
    checking = true;
    try {
      const token = getAccountSessionToken(user.id);
      if (!token) return invalidate();
      const valid = await window.sbValidateUserSession(deviceId, token);
      if (!valid) return invalidate();
      if (touch && typeof window.sbTouchUserSession === 'function') await window.sbTouchUserSession(deviceId, token);
    } catch (error) {
      console.warn('Vérification session unique différée', error);
    } finally {
      checking = false;
    }
  };

  if (typeof window.sbSubscribe === 'function') {
    channel = window.sbSubscribe(
      `account-session-${user.id}-${deviceId.slice(0, 8)}`,
      { event: '*', schema: 'public', table: 'user_active_sessions', filter: `user_id=eq.${user.id}` },
      () => check()
    );
  }

  interval = window.setInterval(() => check({ touch: true }), 12000);
  const focusHandler = () => check({ touch: true });
  const visibilityHandler = () => { if (!document.hidden) check({ touch: true }); };
  window.addEventListener('focus', focusHandler);
  document.addEventListener('visibilitychange', visibilityHandler);
  check({ touch: true });

  return () => {
    stopped = true;
    if (interval) clearInterval(interval);
    window.removeEventListener('focus', focusHandler);
    document.removeEventListener('visibilitychange', visibilityHandler);
    if (channel && typeof window.sbRemoveChannel === 'function') window.sbRemoveChannel(channel).catch(() => {});
  };
}
