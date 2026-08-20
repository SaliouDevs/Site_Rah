const fallbackSettings = {
  maintenance_enabled: false,
  maintenance_title: 'Maintenance en cours',
  maintenance_message: 'Nous effectuons actuellement des améliorations sur eAutoecole.',
  maintenance_until: null,
  school_name: window.APP_CONFIG?.schoolName || 'Auto-école',
  support_phone: window.CONTACT_CONFIG?.phone || '77 583 20 37',
  whatsapp_phone: window.CONTACT_CONFIG?.whatsapp || '221775832037',
  support_email: window.CONTACT_CONFIG?.email || 'eautoecole1@gmail.com',
  support_address: window.CONTACT_CONFIG?.address || '',
  examen_poids_leger_enabled: false,
  examen_poids_lourd_enabled: false,
  announcement_title: '',
  announcement_message: '',
  announcement_expires_at: null,
  session_invalid_before: null
};

let cachedSettings = null;
let settingsChannel = null;

export async function loadAppSettings() {
  if (!window.sb) return { ...fallbackSettings };
  try {
    const { data, error } = await window.sb.from('app_settings').select('*').eq('id', 'global').single();
    if (error) throw error;
    cachedSettings = { ...fallbackSettings, ...(data || {}) };
  } catch (error) {
    cachedSettings = { ...fallbackSettings };
  }
  applySettingsToLegacyConfig(cachedSettings);
  return cachedSettings;
}

export function getCachedAppSettings() {
  return cachedSettings || { ...fallbackSettings };
}

export function getAppSetting(key) {
  return getCachedAppSettings()[key];
}

export function subscribeToAppSettings(callback) {
  if (!window.sbSubscribe || settingsChannel) return settingsChannel;
  settingsChannel = window.sbSubscribe(
    'app-settings-global',
    { event: '*', schema: 'public', table: 'app_settings', filter: 'id=eq.global' },
    async () => callback(await loadAppSettings())
  );
  return settingsChannel;
}

export function teardownSettingsSubscription() {
  if (settingsChannel && window.sbRemoveChannel) {
    window.sbRemoveChannel(settingsChannel);
  }
  settingsChannel = null;
}

function applySettingsToLegacyConfig(settings) {
  if (window.APP_CONFIG) {
    window.APP_CONFIG.schoolName = settings.school_name || window.APP_CONFIG.schoolName;
  }
  if (window.CONTACT_CONFIG) {
    window.CONTACT_CONFIG.phone = settings.support_phone || window.CONTACT_CONFIG.phone;
    window.CONTACT_CONFIG.whatsapp = settings.whatsapp_phone || window.CONTACT_CONFIG.whatsapp;
    window.CONTACT_CONFIG.email = settings.support_email || window.CONTACT_CONFIG.email;
    window.CONTACT_CONFIG.address = settings.support_address || window.CONTACT_CONFIG.address;
  }
  if (window.EXAMS_CONFIG) {
    const lightEnabled = Boolean(settings.examen_poids_leger_enabled);
    const heavyEnabled = Boolean(settings.examen_poids_lourd_enabled);
    window.EXAMS_CONFIG.light = { ...(window.EXAMS_CONFIG.light || {}), status: lightEnabled ? 'online' : 'verification', enabled: lightEnabled };
    window.EXAMS_CONFIG.heavy = { ...(window.EXAMS_CONFIG.heavy || {}), status: heavyEnabled ? 'online' : 'verification', enabled: heavyEnabled };
    window.EXAMS_CONFIG.poidsLegerEnabled = lightEnabled;
    window.EXAMS_CONFIG.poidsLourdEnabled = heavyEnabled;
  }
}
