const FALLBACK_SCHOOL = Object.freeze({
  id: 'global',
  app_name: window.APP_CONFIG?.name || 'eAutoecole',
  school_name: window.APP_CONFIG?.schoolName || 'Auto-école',
  tagline: 'Apprendre. S’entraîner. Réussir.',
  hero_title: 'Votre permis commence ici.',
  hero_message: 'Un parcours guidé, des entraînements adaptés et un suivi humain pour progresser avec confiance.',
  phone: window.CONTACT_CONFIG?.phone || '',
  phone_href: window.CONTACT_CONFIG?.phoneHref || '',
  whatsapp: window.CONTACT_CONFIG?.whatsapp || '',
  email: window.CONTACT_CONFIG?.email || '',
  address: window.CONTACT_CONFIG?.address || '',
  city: 'Dakar',
  logo_url: null,
  primary_color: '#155EEF',
  accent_color: '#12B76A',
  plan_name: 'Formule Illimitée',
  registration_price: 2000,
  wave_payment_url: 'https://pay.wave.com/m/M_sn_h8KvN46A4_zB/c/sn/',
  payments_enabled: true
});

let cache = null;

export async function loadSchoolSettings({ force = false } = {}) {
  if (!force && cache) return cache;
  if (!window.sb) return applySchoolSettings({ ...FALLBACK_SCHOOL });
  try {
    const { data, error } = await window.sb.from('school_settings').select('*').eq('id', 'global').maybeSingle();
    if (error) throw error;
    cache = { ...FALLBACK_SCHOOL, ...(data || {}) };
  } catch (error) {
    console.warn('Identité auto-école indisponible, fallback local conservé', error);
    cache = { ...FALLBACK_SCHOOL };
  }
  return applySchoolSettings(cache);
}

export async function saveSchoolSettings(settings = {}) {
  if (!window.sb) throw new Error('Supabase indisponible');
  const normalized = { ...settings };
  if (typeof normalized.payments_enabled === 'string') normalized.payments_enabled = normalized.payments_enabled === 'true' || normalized.payments_enabled === 'on';
  const { data, error } = await window.sb.rpc('save_school_settings', { p_settings: normalized });
  if (error) throw error;
  cache = { ...FALLBACK_SCHOOL, ...(data || {}) };
  return applySchoolSettings(cache);
}

export function getCachedSchoolSettings() {
  return cache || { ...FALLBACK_SCHOOL };
}

export function applySchoolSettings(settings = {}) {
  const merged = { ...FALLBACK_SCHOOL, ...settings };
  merged.registration_price = Number(merged.registration_price || 0);
  merged.payments_enabled = merged.payments_enabled !== false;
  window.EAUTO_SCHOOL_SETTINGS = merged;
  if (window.APP_CONFIG) {
    window.APP_CONFIG.name = merged.app_name || window.APP_CONFIG.name;
    window.APP_CONFIG.schoolName = merged.school_name || window.APP_CONFIG.schoolName;
  }
  if (window.CONTACT_CONFIG) {
    window.CONTACT_CONFIG.phone = merged.phone || window.CONTACT_CONFIG.phone;
    window.CONTACT_CONFIG.phoneHref = merged.phone_href || window.CONTACT_CONFIG.phoneHref;
    window.CONTACT_CONFIG.whatsapp = merged.whatsapp || window.CONTACT_CONFIG.whatsapp;
    window.CONTACT_CONFIG.email = merged.email || window.CONTACT_CONFIG.email;
    window.CONTACT_CONFIG.address = merged.address || window.CONTACT_CONFIG.address;
  }
  const root = document.documentElement;
  root.style.setProperty('--school-primary', merged.primary_color || FALLBACK_SCHOOL.primary_color);
  root.style.setProperty('--school-accent', merged.accent_color || FALLBACK_SCHOOL.accent_color);
  document.title = `${merged.app_name || 'eAutoecole'} - ${merged.school_name || 'Auto-école'}`;
  document.dispatchEvent(new CustomEvent('school-settings-ready', { detail: merged }));
  return merged;
}
