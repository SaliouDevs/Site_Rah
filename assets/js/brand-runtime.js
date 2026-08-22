import { loadSchoolSettings } from './services/school-service.js';

try {
  const settings = await loadSchoolSettings();
  hydrateBrand(settings);
  document.addEventListener('school-settings-ready', (event) => hydrateBrand(event.detail));
} catch (error) {
  console.warn('Branding dynamique indisponible', error);
}

function hydrateBrand(settings = {}) {
  document.querySelectorAll('[data-app-name],[data-brand-app]').forEach((node) => { node.textContent = settings.app_name || 'eAutoecole'; });
  document.querySelectorAll('[data-school-name]').forEach((node) => { node.textContent = settings.school_name || 'Auto-école'; });
  document.querySelectorAll('[data-school-hero-title]').forEach((node) => { node.textContent = settings.hero_title || node.textContent; });
  document.querySelectorAll('[data-school-hero-message]').forEach((node) => { node.textContent = settings.hero_message || node.textContent; });
  document.querySelectorAll('[data-brand-school]').forEach((node) => {
    const suffix = node.textContent.includes('Moniteur') ? ' · Espace Moniteur' : node.textContent.includes('Pilotage') ? ' · Pilotage' : '';
    node.textContent = `${settings.school_name || 'Auto-école'}${suffix}`;
  });
  document.querySelectorAll('[data-school-logo]').forEach((node) => {
    if (!settings.logo_url) return;
    node.innerHTML = `<img src="${escapeAttribute(settings.logo_url)}" alt="Logo ${escapeAttribute(settings.school_name || 'Auto-école')}" style="width:100%;height:100%;object-fit:contain;border-radius:inherit">`;
  });
}

function escapeAttribute(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
}
