import {
  getMaintenanceMessage,
  loadRuntimeSettings,
  subscribeToRuntimeSettings,
  teardownRuntimeSettingsSubscription
} from './runtime-service.js';

const MAINTENANCE_MESSAGE_KEY = 'maintenance_message';
const DEFAULT_POLL_INTERVAL_MS = 15000;

let activeGuard = null;

export function startMaintenanceGuard({
  user,
  onMaintenance,
  redirectUrl = 'auth.html?maintenance=1',
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
} = {}) {
  stopMaintenanceGuard();

  if (isAdminUser(user)) {
    return null;
  }

  let handlingMaintenance = false;
  let stopped = false;

  async function enforceMaintenance(settings) {
    if (handlingMaintenance || stopped || !settings?.maintenance_enabled) return;
    handlingMaintenance = true;
    sessionStorage.setItem(MAINTENANCE_MESSAGE_KEY, getMaintenanceMessage(settings));
    if (typeof onMaintenance === 'function') {
      onMaintenance(settings);
    }
    try {
      if (typeof window.sbLogout === 'function') {
        await window.sbLogout();
      }
    } catch (error) {
      console.warn('Maintenance signOut failed', error);
    } finally {
      window.location.href = redirectUrl;
    }
  }

  async function checkNow() {
    if (stopped || handlingMaintenance) return;
    try {
      const settings = await loadRuntimeSettings({ force: true });
      await enforceMaintenance(settings);
    } catch (error) {
      console.warn('Maintenance check failed', error);
    }
  }

  const onFocus = () => checkNow();
  const onOnline = () => checkNow();
  const onRouteChange = () => checkNow();
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') checkNow();
  };

  subscribeToRuntimeSettings((settings) => enforceMaintenance(settings));
  const pollId = window.setInterval(checkNow, pollIntervalMs);
  window.addEventListener('focus', onFocus);
  window.addEventListener('online', onOnline);
  window.addEventListener('hashchange', onRouteChange);
  document.addEventListener('visibilitychange', onVisibilityChange);
  checkNow();

  activeGuard = {
    stop() {
      stopped = true;
      window.clearInterval(pollId);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('hashchange', onRouteChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  };
  return activeGuard;
}

export function stopMaintenanceGuard() {
  if (!activeGuard) return;
  activeGuard.stop();
  teardownRuntimeSettingsSubscription();
  activeGuard = null;
}

function isAdminUser(user) {
  return Boolean(user?.isAdmin || user?.app_metadata?.role === 'admin');
}
