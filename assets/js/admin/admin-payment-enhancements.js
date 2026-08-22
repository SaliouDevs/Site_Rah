const paymentState = { loading: false };

document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('admin-view');
  if (!root) return;
  const observer = new MutationObserver(() => queueMicrotask(() => enhanceUsers(root)));
  observer.observe(root, { childList: true, subtree: true });
  enhanceUsers(root);
});

async function enhanceUsers(root) {
  if (root.querySelector('.admin-heading h1')?.textContent?.trim() !== 'Utilisateurs') return;
  if (root.querySelector('[data-payment-queue]') || paymentState.loading) return;
  const anchor = root.querySelector('.admin-heading');
  if (!anchor || !window.sb) return;
  paymentState.loading = true;
  const panel = document.createElement('section');
  panel.className = 'admin-card payment-review-card';
  panel.dataset.paymentQueue = 'true';
  panel.innerHTML = '<div class="card-heading"><h2>Paiements à vérifier</h2><span>Chargement...</span></div>';
  anchor.insertAdjacentElement('afterend', panel);
  try {
    const claims = await loadClaims();
    renderClaims(panel, claims);
  } catch (error) {
    panel.innerHTML = `<div class="card-heading"><h2>Paiements à vérifier</h2></div><p class="product-muted">${escapeHTML(error.message || 'File de paiement indisponible.')}</p>`;
  } finally {
    paymentState.loading = false;
  }
}

async function loadClaims() {
  const { data: claims, error } = await window.sb.from('payment_claims').select('*').eq('status', 'submitted').order('submitted_at', { ascending: true });
  if (error) throw error;
  const rows = claims || [];
  if (!rows.length) return [];
  const ids = [...new Set(rows.map((row) => row.user_id))];
  const { data: profiles, error: profileError } = await window.sb.from('profiles').select('id,prenom,telephone,status').in('id', ids);
  if (profileError) throw profileError;
  const byId = new Map((profiles || []).map((profile) => [profile.id, profile]));
  return rows.map((row) => ({ ...row, profile: byId.get(row.user_id) || null }));
}

function renderClaims(panel, claims) {
  panel.innerHTML = `
    <div class="card-heading"><div><h2>Paiements à vérifier</h2><p class="product-muted">Valide seulement après avoir retrouvé la transaction dans ton compte Wave.</p></div><span class="badge ${claims.length ? 'pending' : 'active'}">${claims.length} en attente</span></div>
    ${claims.length ? `<div class="payment-review-list">${claims.map(renderClaim).join('')}</div>` : '<div class="empty-product"><i class="fas fa-circle-check"></i><strong>Aucun paiement à vérifier</strong><span>La file est à jour.</span></div>'}`;
  panel.querySelectorAll('[data-approve-payment]').forEach((button) => button.addEventListener('click', () => review(button.dataset.approvePayment, 'approved', button)));
  panel.querySelectorAll('[data-reject-payment]').forEach((button) => button.addEventListener('click', () => openReject(button.dataset.rejectPayment, button)));
}

function renderClaim(claim) {
  const profile = claim.profile || {};
  return `<article class="payment-review-row"><div class="payment-review-person"><span class="person-avatar">${initials(profile.prenom)}</span><div><strong>${escapeHTML(profile.prenom || 'Élève')}</strong><small>${escapeHTML(formatPhone(profile.telephone))} · ${escapeHTML(claim.plan_name)}</small></div></div><div class="payment-review-amount"><strong>${Number(claim.amount || 0).toLocaleString('fr-FR')} FCFA</strong><small>${formatDateTime(claim.submitted_at)}</small></div><div class="payment-review-actions"><button class="admin-secondary danger" data-reject-payment="${claim.id}">Refuser</button><button class="admin-button" data-approve-payment="${claim.id}">Valider</button></div></article>`;
}

async function review(claimId, decision, button, note = '') {
  if (button.disabled) return;
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Patiente...';
  try {
    const { data, error } = await window.sb.rpc('admin_review_payment_claim', { p_claim_id: claimId, p_decision: decision, p_note: note || null });
    if (error) throw error;
    if (!data) throw new Error('Cette déclaration a déjà été traitée.');
    toast(decision === 'approved' ? 'Paiement validé, compte activé.' : 'Paiement refusé.');
    const panel = document.querySelector('[data-payment-queue]');
    if (panel) renderClaims(panel, await loadClaims());
    document.querySelector('[data-refresh]')?.click();
  } catch (error) {
    toast(error.message || 'Action refusée.', true);
    button.disabled = false;
    button.textContent = label;
  }
}

function openReject(claimId, sourceButton) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="product-modal-backdrop"><form class="product-modal" data-reject-payment-form><p class="eyebrow">Paiement</p><h2>Refuser cette déclaration ?</h2><p class="product-muted">Le compte reste en attente. Tu peux laisser une note interne.</p><textarea name="note" maxlength="1000" placeholder="Motif ou référence vérifiée" style="width:100%;min-height:100px;margin:12px 0;padding:10px;border:1px solid var(--border);border-radius:10px"></textarea><div class="editor-actions"><button class="secondary-product" type="button" data-close-payment-modal>Annuler</button><button class="danger-product" type="submit">Refuser</button></div></form></div>`;
  root.querySelector('[data-close-payment-modal]')?.addEventListener('click', () => root.innerHTML = '');
  root.querySelector('[data-reject-payment-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const note = new FormData(event.currentTarget).get('note');
    const button = event.currentTarget.querySelector('[type="submit"]');
    await review(claimId, 'rejected', button, note);
    root.innerHTML = '';
    sourceButton.disabled = false;
  });
}

function toast(message, error = false) {
  const root = document.getElementById('toast-root');
  root.innerHTML = `<div class="product-toast ${error ? 'error' : ''}">${escapeHTML(message)}</div>`;
  clearTimeout(root.paymentTimer);
  root.paymentTimer = setTimeout(() => { root.innerHTML = ''; }, 2800);
}
function initials(name) { return escapeHTML(String(name || 'É').trim().split(/\s+/).slice(0,2).map((p) => p[0] || '').join('').toUpperCase()); }
function formatPhone(value) { const digits = String(value || '').replace(/\D/g, '').replace(/^221/,''); return digits.length === 9 ? `${digits.slice(0,2)} ${digits.slice(2,5)} ${digits.slice(5,7)} ${digits.slice(7)}` : String(value || ''); }
function formatDateTime(value) { try { return new Intl.DateTimeFormat('fr-FR', { dateStyle:'medium',timeStyle:'short' }).format(new Date(value)); } catch { return String(value || ''); } }
function escapeHTML(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char])); }
