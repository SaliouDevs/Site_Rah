document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('admin-view');
  if (!root) return;
  const observer = new MutationObserver(() => queueMicrotask(() => enhanceBrandForm(root)));
  observer.observe(root, { childList: true, subtree: true });
  enhanceBrandForm(root);
});

document.addEventListener('school-settings-ready', () => {
  window.setTimeout(() => {
    const button = document.querySelector('[data-brand-form] [type="submit"]');
    if (button?.disabled && /Patiente/i.test(button.textContent || '')) {
      button.disabled = false;
      button.textContent = button.dataset.originalLabel || 'Enregistrer l’identité';
    }
  }, 150);
});

function enhanceBrandForm(root) {
  const form = root.querySelector('[data-brand-form]');
  if (!form || form.dataset.commercialReady === '1') return;
  form.dataset.commercialReady = '1';
  const settings = window.EAUTO_SCHOOL_SETTINGS || {};
  const submit = form.querySelector('[type="submit"]');
  const block = document.createElement('section');
  block.className = 'commercial-settings-block';
  block.innerHTML = `
    <div class="commercial-divider"><span><i class="fas fa-credit-card"></i> Offre & inscription</span></div>
    <div class="editor-grid">
      <label>Nom de la formule<input name="plan_name" maxlength="120" value="${escapeAttr(settings.plan_name || 'Formule Illimitée')}" required></label>
      <label>Prix inscription (FCFA)<input name="registration_price" type="number" min="0" max="10000000" step="100" value="${Number(settings.registration_price ?? 2000)}" required></label>
    </div>
    <label>Paiement Wave · lien marchand<input name="wave_payment_url" type="url" value="${escapeAttr(settings.wave_payment_url || '')}" placeholder="https://pay.wave.com/..."><small class="product-muted">Le montant est ajouté automatiquement au lien lors du paiement.</small></label>
    <label>Paiement en ligne<select name="payments_enabled"><option value="true" ${settings.payments_enabled !== false ? 'selected' : ''}>Activé · Wave + vérification admin</option><option value="false" ${settings.payments_enabled === false ? 'selected' : ''}>Désactivé · validation manuelle uniquement</option></select></label>`;
  submit?.insertAdjacentElement('beforebegin', block);
}

function escapeAttr(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
}
