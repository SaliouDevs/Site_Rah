import { loadExamSettings } from './exam-service.js';
import { loadRuntimeSettings } from './runtime-service.js';
import { loadSchoolSettings } from './school-service.js';

const fallbackSettings = {
  maintenance_enabled: false,
  maintenance_title: 'Maintenance en cours',
  maintenance_message: 'Nous effectuons actuellement des améliorations sur eAutoecole.',
  maintenance_until: null,
  school_name: window.APP_CONFIG?.schoolName || 'Auto-école',
  app_name: window.APP_CONFIG?.name || 'eAutoecole',
  support_phone: window.CONTACT_CONFIG?.phone || '77 583 20 37',
  whatsapp_phone: window.CONTACT_CONFIG?.whatsapp || '221775832037',
  support_email: window.CONTACT_CONFIG?.email || 'eautoecole1@gmail.com',
  support_address: window.CONTACT_CONFIG?.address || '',
  hero_title: 'Votre permis commence ici.',
  hero_message: 'Un parcours guidé, des entraînements adaptés et un suivi humain pour progresser avec confiance.',
  tagline: 'Apprendre. S’entraîner. Réussir.',
  primary_color: '#155EEF',
  accent_color: '#12B76A',
  logo_url: null,
  examen_poids_leger_enabled: false,
  examen_poids_lourd_enabled: false,
  announcement_title: '',
  announcement_message: '',
  announcement_expires_at: null,
  session_invalid_before: null
};

let cachedSettings = null;
let settingsChannel = null;

export async function loadAppSettings({ force = false } = {}) {
  if (!force && cachedSettings) return cachedSettings;
  if (!window.sb) return { ...fallbackSettings };

  const [legacyResult, examResult, runtimeResult, schoolResult] = await Promise.allSettled([
    loadLegacySettings(),
    loadExamSettings({ force: true }),
    loadRuntimeSettings({ force: true }),
    loadSchoolSettings({ force })
  ]);

  const legacy = legacyResult.status === 'fulfilled' ? legacyResult.value : {};
  const examSettings = examResult.status === 'fulfilled' ? examResult.value : [];
  const runtimeSettings = runtimeResult.status === 'fulfilled'
    ? runtimeResult.value
    : { maintenance_enabled: false, maintenance_message: fallbackSettings.maintenance_message };
  const school = schoolResult.status === 'fulfilled' ? schoolResult.value : {};

  cachedSettings = {
    ...fallbackSettings,
    ...legacy,
    ...school,
    school_name: school.school_name || legacy.school_name || fallbackSettings.school_name,
    app_name: school.app_name || fallbackSettings.app_name,
    support_phone: school.phone || legacy.support_phone || fallbackSettings.support_phone,
    whatsapp_phone: school.whatsapp || legacy.whatsapp_phone || fallbackSettings.whatsapp_phone,
    support_email: school.email || legacy.support_email || fallbackSettings.support_email,
    support_address: school.address || legacy.support_address || fallbackSettings.support_address,
    maintenance_enabled: Boolean(runtimeSettings.maintenance_enabled),
    maintenance_message: runtimeSettings.maintenance_message || fallbackSettings.maintenance_message,
    exam_settings: examSettings,
    runtime_settings: runtimeSettings,
    school_settings: school
  };

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
    'school-settings-global',
    { event: '*', schema: 'public', table: 'school_settings', filter: 'id=eq.global' },
    async () => {
      cachedSettings = null;
      callback(await loadAppSettings({ force: true }));
    }
  );
  return settingsChannel;
}

export function teardownSettingsSubscription() {
  if (settingsChannel && window.sbRemoveChannel) window.sbRemoveChannel(settingsChannel);
  settingsChannel = null;
}

async function loadLegacySettings() {
  const { data, error } = await window.sb.from('app_settings').select('*').eq('id', 'global').maybeSingle();
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205' || /app_settings/i.test(error.message || '')) return {};
    throw error;
  }
  return data || {};
}

function applySettingsToLegacyConfig(settings) {
  if (window.APP_CONFIG) {
    window.APP_CONFIG.name = settings.app_name || window.APP_CONFIG.name;
    window.APP_CONFIG.schoolName = settings.school_name || window.APP_CONFIG.schoolName;
  }
  if (window.CONTACT_CONFIG) {
    window.CONTACT_CONFIG.phone = settings.support_phone || window.CONTACT_CONFIG.phone;
    window.CONTACT_CONFIG.whatsapp = settings.whatsapp_phone || window.CONTACT_CONFIG.whatsapp;
    window.CONTACT_CONFIG.email = settings.support_email || window.CONTACT_CONFIG.email;
    window.CONTACT_CONFIG.address = settings.support_address || window.CONTACT_CONFIG.address;
  }
}
