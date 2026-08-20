import { loadExamSettings } from './exam-service.js';

const DEFAULT_POLL_INTERVAL_MS = 15000;
let activeSync = null;
let examSettingsChannel = null;

export function startExamSettingsSync({ pollIntervalMs = DEFAULT_POLL_INTERVAL_MS } = {}) {
  stopExamSettingsSync();

  let stopped = false;
  let refreshing = false;

  async function refresh() {
    if (stopped || refreshing) return;
    refreshing = true;
    try {
      await loadExamSettings({ force: true, emit: true });
    } catch (error) {
      console.warn('Synchronisation examens échouée', error);
    } finally {
      refreshing = false;
    }
  }

  const onFocus = () => refresh();
  const onOnline = () => refresh();
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') refresh();
  };

  if (typeof window.sbSubscribe === 'function') {
    examSettingsChannel = window.sbSubscribe(
      'exam-settings-live',
      { event: '*', schema: 'public', table: 'exam_settings' },
      () => refresh()
    );
  }

  const pollId = window.setInterval(refresh, pollIntervalMs);
  window.addEventListener('focus', onFocus);
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisibilityChange);
  refresh();

  activeSync = {
    stop() {
      stopped = true;
      window.clearInterval(pollId);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (examSettingsChannel && typeof window.sbRemoveChannel === 'function') {
        window.sbRemoveChannel(examSettingsChannel);
      }
      examSettingsChannel = null;
    }
  };

  return activeSync;
}

export function stopExamSettingsSync() {
  if (!activeSync) return;
  activeSync.stop();
  activeSync = null;
}
