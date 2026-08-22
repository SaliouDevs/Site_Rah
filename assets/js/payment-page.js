import { loadSchoolSettings } from './services/school-service.js';

const pending = {
  phone: sessionStorage.getItem('pending_phone') || '',
  formula: sessionStorage.getItem('pending_formule') || '',
  price: Number(sessionStorage.getItem('pending_prix') || 0)
};
let school = null;
let busy = false;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  if (!pending.phone) {
    window.location.replace('auth.html');
    return;
  }
  school = await loadSchoolSettings().catch(() => window.EAUTO_SCHOOL_SETTINGS || {});
  const formula = pending.formula || school.plan_name || 'Formule Illimitée';
  const price = Number.isFinite(pending.price) && pending.price >= 0 ? pending.price : Number(school.registration_price || 0);
  document.querySelector('[data-payment-formula]').textContent = formula;
  document.querySelector('[data-payment-price]').textContent = formatMoney(price);
  document.querySelector('[data-confirm-phone]').textContent = `+221 ${formatPhone(pending.phone)}`;
  document.querySelector('[data-confirm-formula]').textContent = formula;
  document.querySelector('[data-confirm-price]').textContent = formatMoney(price);
  document.querySelector('[data-confirm-date]').textContent = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(new Date());

  bindActions();
  const claim = await loadExistingClaim();
  if (claim?.status === 'submitted') {
    showSubmitted();
    return;
  }
  if (school.payments_enabled === false) {
    showNoPayment();
  }
}

function bindActions() {
  document.querySelector('[data-pay-wave]')?.addEventListener('click', openWave);
  document.querySelector('[data-confirm-payment]')?.addEventListener('click', submitClaim);
  document.querySelectorAll('[data-back-auth]').forEach((button) => button.addEventListener('click', () => window.location.href = 'auth.html'));
}

function openWave() {
  const base = school?.wave_payment_url;
  if (!base) {
    showError('Le lien de paiement Wave n’est pas encore configuré. Contactez l’auto-école.');
    return;
  }
  let url;
  try {
    url = new URL(base);
    url.searchParams.set('amount', String(Number(school.registration_price || pending.price || 0)));
  } catch {
    showError('Le lien Wave configuré est invalide. Contactez l’auto-école.');
    return;
  }
  window.open(url.toString(), '_blank', 'noopener,noreferrer');
  document.querySelector('[data-confirm-payment]').hidden = false;
  document.querySelector('[data-payment-help]').textContent = 'Après avoir validé le paiement dans Wave, reviens ici puis confirme. L’administrateur vérifiera ensuite la transaction.';
}

async function submitClaim() {
  if (busy) return;
  busy = true;
  const button = document.querySelector('[data-confirm-payment]');
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = '<span class="spinner"></span> Enregistrement...';
  clearError();
  try {
    if (!window.sb) throw new Error('Connexion au serveur indisponible.');
    const { data, error } = await window.sb.rpc('student_submit_payment_claim');
    if (error) throw error;
    if (!data) throw new Error('La déclaration n’a pas pu être enregistrée.');
    clearPendingStorage();
    showSubmitted();
  } catch (error) {
    showError(normalizeError(error));
    button.disabled = false;
    button.innerHTML = original;
  } finally {
    busy = false;
  }
}

async function loadExistingClaim() {
  try {
    const session = await window.sbGetSession?.();
    if (!session?.user) return null;
    const { data, error } = await window.sb.from('payment_claims').select('*').eq('user_id', session.user.id).order('submitted_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data || null;
  } catch {
    return null;
  }
}

function showSubmitted() {
  document.querySelector('[data-payment-step]').hidden = true;
  const confirmation = document.querySelector('[data-confirmation-step]');
  confirmation.hidden = false;
  confirmation.querySelector('[data-status-title]').textContent = 'Paiement déclaré';
  confirmation.querySelector('[data-status-copy]').textContent = 'Ta déclaration a été enregistrée. L’auto-école vérifie le paiement avant d’activer ton compte.';
  clearPendingStorage();
}

function showNoPayment() {
  document.querySelector('[data-pay-wave]').hidden = true;
  document.querySelector('[data-confirm-payment]').hidden = true;
  document.querySelector('[data-payment-help]').textContent = 'Cette auto-école a désactivé le paiement en ligne. Ton inscription reste en attente de validation par l’administrateur.';
  document.querySelector('[data-payment-headline]').textContent = 'Inscription enregistrée';
}

function clearPendingStorage() {
  sessionStorage.removeItem('pending_phone');
  sessionStorage.removeItem('pending_formule');
  sessionStorage.removeItem('pending_prix');
}
function showError(message) { const root = document.querySelector('[data-payment-error]'); root.hidden = false; root.textContent = message; }
function clearError() { const root = document.querySelector('[data-payment-error]'); root.hidden = true; root.textContent = ''; }
function formatMoney(value) { return `${Number(value || 0).toLocaleString('fr-FR')} FCFA`; }
function formatPhone(value) { const digits = String(value || '').replace(/\D/g, '').replace(/^221/, ''); return digits.length === 9 ? `${digits.slice(0,2)} ${digits.slice(2,5)} ${digits.slice(5,7)} ${digits.slice(7)}` : String(value || ''); }
function normalizeError(error) {
  const text = error?.message || 'Erreur inconnue.';
  if (/Authentication required|JWT|session/i.test(text)) return 'Ta session d’inscription a expiré. Reconnecte-toi puis réessaie.';
  if (/already|duplicate|unique/i.test(text)) return 'Une déclaration de paiement est déjà en cours de vérification.';
  if (/disabled/i.test(text)) return 'Le paiement en ligne est actuellement désactivé.';
  return text;
}
