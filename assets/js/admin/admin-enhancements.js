import { deleteUser } from '../services/admin-service.js';

const pending = new Set();

document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('admin-view');
  if (!root) return;
  enhanceUsers(root);
  const observer = new MutationObserver(() => enhanceUsers(root));
  observer.observe(root, { childList: true, subtree: true });
});

function enhanceUsers(root) {
  root.querySelectorAll('[data-reset-password]').forEach((anchor) => {
    const userId = anchor.dataset.resetPassword;
    if (!userId || anchor.parentElement?.querySelector(`[data-delete-user="${CSS.escape(userId)}"]`)) return;
    if (window.EAUTO_CURRENT_USER?.id === userId) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'admin-danger admin-delete-user';
    button.dataset.deleteUser = userId;
    button.textContent = 'Supprimer';
    button.addEventListener('click', () => openDeleteDialog(userId, anchor));
    anchor.parentElement?.appendChild(button);
  });
}

function openDeleteDialog(userId, anchor) {
  if (pending.has(userId)) return;
  const root = document.getElementById('modal-root');
  if (!root) return;
  const card = anchor.closest('.user-card, tr');
  const rename = card?.querySelector('[data-rename]');
  const name = rename?.dataset.currentName || 'cet utilisateur';
  root.innerHTML = `
    <div class="modal-backdrop">
      <form class="admin-modal delete-user-modal" data-delete-user-form>
        <div class="danger-icon"><i class="fas fa-user-xmark"></i></div>
        <div><p class="eyebrow">Action irréversible</p><h2>Supprimer ${escapeHTML(name)} ?</h2></div>
        <p>Le compte de connexion, le profil, les sessions actives et les données d'apprentissage liées seront supprimés.</p>
        <label>Écris <strong>SUPPRIMER</strong> pour confirmer
          <input name="confirmation" autocomplete="off" required placeholder="SUPPRIMER">
        </label>
        <div class="admin-actions">
          <button class="admin-secondary" type="button" data-close-modal>Annuler</button>
          <button class="admin-danger" type="submit">Supprimer définitivement</button>
        </div>
      </form>
    </div>`;
  root.querySelector('[data-close-modal]')?.addEventListener('click', () => { root.innerHTML = ''; });
  root.querySelector('[data-delete-user-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (new FormData(form).get('confirmation') !== 'SUPPRIMER') {
      showInlineError(form, 'Confirmation incorrecte.');
      return;
    }
    const submit = form.querySelector('[type="submit"]');
    pending.add(userId);
    setBusy(submit, true);
    try {
      const deleted = await deleteUser(userId);
      if (!deleted) throw new Error('Utilisateur introuvable');
      root.innerHTML = '';
      toast('Utilisateur supprimé.');
      document.querySelector('[data-refresh]')?.click();
    } catch (error) {
      showInlineError(form, error.message || 'Suppression refusée.');
      setBusy(submit, false);
    } finally {
      pending.delete(userId);
    }
  });
}

function setBusy(button, busy) {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = 'Suppression...';
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || 'Supprimer définitivement';
    button.disabled = false;
  }
}

function showInlineError(form, message) {
  let error = form.querySelector('.delete-user-error');
  if (!error) {
    error = document.createElement('p');
    error.className = 'delete-user-error';
    form.insertBefore(error, form.querySelector('.admin-actions'));
  }
  error.textContent = message;
}

function toast(message) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  root.innerHTML = `<div class="toast">${escapeHTML(message)}</div>`;
  setTimeout(() => { root.innerHTML = ''; }, 2600);
}

function escapeHTML(text) {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}
