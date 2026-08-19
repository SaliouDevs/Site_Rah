import { requireAuthenticatedUser, logoutCurrentUser, resolveLocalDevUser } from './services/auth-service.js';
import { loadAdminOverview, renameUser, resetUserPassword, updateUserStatus } from './services/admin-service.js';

const state = {
  currentView: 'dashboard',
  currentUser: null,
  profiles: [],
  filter: 'all',
  query: ''
};

document.addEventListener('DOMContentLoaded', initAdmin);

async function initAdmin() {
  setView('<section class="admin-card">Chargement admin...</section>');

  const dev = resolveLocalDevUser();
  if (dev?.isAdmin) {
    state.currentUser = dev;
    window.EAUTO_CURRENT_USER = state.currentUser;
    bindShell();
    render();
    return;
  }

  const auth = await requireAuthenticatedUser({ allowAdmin: true });
  if (!auth) return;
  if (!auth.profile?.isAdmin) {
    await window.sbLogout();
    window.location.href = 'auth.html?admin=denied';
    return;
  }

  state.currentUser = auth.profile;
  window.EAUTO_CURRENT_USER = state.currentUser;
  bindShell();
  await refreshData();
  render();
}

function bindShell() {
  document.querySelectorAll('[data-admin-view]').forEach((button) => {
    button.addEventListener('click', () => {
      state.currentView = button.dataset.adminView;
      render();
    });
  });
  document.querySelector('[data-admin-logout]').addEventListener('click', () => logoutCurrentUser(state.currentUser));
}

async function refreshData() {
  const overview = await loadAdminOverview();
  state.profiles = overview.profiles || [];
}

function render() {
  document.querySelectorAll('[data-admin-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.adminView === state.currentView);
  });
  if (state.currentView === 'users') {
    renderUsers();
  } else {
    renderDashboard();
  }
}

function renderDashboard() {
  const counts = countProfiles();
  const latest = [...state.profiles].slice(0, 6);
  setView(`
    <section class="admin-view">
      <div class="admin-heading">
        <div>
          <p class="eyebrow">Administration</p>
          <h1>Tableau de bord</h1>
        </div>
        <button class="admin-secondary" type="button" data-refresh>Actualiser</button>
      </div>
      <div class="admin-grid metrics">
        ${metric('Utilisateurs total', counts.total)}
        ${metric('En attente', counts.pending)}
        ${metric('Actifs', counts.active)}
        ${metric('Bloqués', counts.blocked)}
      </div>
      <section class="admin-card">
        <div class="card-heading">
          <h2>Examens en correction</h2>
        </div>
        <div class="admin-actions">
          <button class="admin-secondary" type="button" data-preview-exam="poids_leger">Prévisualiser Poids Léger</button>
          <button class="admin-secondary" type="button" data-preview-exam="poids_lourd">Prévisualiser Poids Lourd</button>
        </div>
      </section>
      <section class="admin-card">
        <div class="card-heading">
          <h2>Dernières inscriptions</h2>
          <button class="admin-secondary" type="button" data-open-users>Voir utilisateurs</button>
        </div>
        <div class="latest-list">
          ${latest.map(latestProfile).join('') || '<p>Aucune inscription.</p>'}
        </div>
      </section>
    </section>
  `);
  document.querySelector('[data-refresh]').addEventListener('click', async () => {
    await runAction(refreshData, 'Données actualisées', false);
  });
  document.querySelector('[data-open-users]').addEventListener('click', () => {
    state.currentView = 'users';
    render();
  });
  document.querySelectorAll('[data-preview-exam]').forEach((button) => {
    button.addEventListener('click', () => {
      const examId = button.dataset.previewExam;
      if (window.canPreviewExam?.(examId, state.currentUser)) {
        window.location.href = `index.html${window.getExamPreviewUrl(examId)}`;
      }
    });
  });
}

function renderUsers() {
  const profiles = filteredProfiles();
  setView(`
    <section class="admin-view">
      <div class="admin-heading">
        <div>
          <p class="eyebrow">Gestion</p>
          <h1>Utilisateurs</h1>
        </div>
        <button class="admin-secondary" type="button" data-refresh>Actualiser</button>
      </div>
      <section class="admin-card admin-form user-tools">
        <label>Recherche
          <input data-user-search placeholder="Prénom ou téléphone" value="${escapeAttribute(state.query)}">
        </label>
        <label>Filtre
          <select data-user-filter>
            ${['all', 'pending', 'active', 'blocked'].map((status) => `<option value="${status}" ${state.filter === status ? 'selected' : ''}>${statusLabel(status)}</option>`).join('')}
          </select>
        </label>
      </section>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>Prénom</th><th>Téléphone</th><th>Formule</th><th>Statut</th><th>Actions</th></tr></thead>
          <tbody>${profiles.map(userRow).join('') || '<tr><td colspan="5">Aucun utilisateur</td></tr>'}</tbody>
        </table>
      </div>
      <div class="admin-user-cards">
        ${profiles.map(userCard).join('') || '<section class="admin-card">Aucun utilisateur</section>'}
      </div>
    </section>
  `);
  document.querySelector('[data-refresh]').addEventListener('click', async () => {
    await runAction(refreshData, 'Données actualisées', false);
  });
  document.querySelector('[data-user-search]').addEventListener('input', (event) => {
    state.query = event.target.value;
    renderUsers();
  });
  document.querySelector('[data-user-filter]').addEventListener('change', (event) => {
    state.filter = event.target.value;
    renderUsers();
  });
  bindUserActions();
}

function userRow(profile) {
  return `
    <tr>
      <td>${escapeHTML(profile.prenom || 'Élève')}</td>
      <td>${escapeHTML(profile.telephone || '')}</td>
      <td>${escapeHTML(profile.formule || 'Formule Illimitée')}<br><small>${formatPrice(profile.prix)}</small></td>
      <td><span class="badge ${escapeAttribute(profile.status)}">${statusLabel(profile.status)}</span></td>
      <td>${actionButtons(profile)}</td>
    </tr>
  `;
}

function userCard(profile) {
  return `
    <section class="admin-card user-card">
      <div>
        <strong>${escapeHTML(profile.prenom || 'Élève')}</strong>
        <span class="badge ${escapeAttribute(profile.status)}">${statusLabel(profile.status)}</span>
      </div>
      <dl>
        <div><dt>Téléphone</dt><dd>${escapeHTML(profile.telephone || '')}</dd></div>
        <div><dt>Formule</dt><dd>${escapeHTML(profile.formule || 'Formule Illimitée')}</dd></div>
        <div><dt>Prix</dt><dd>${formatPrice(profile.prix)}</dd></div>
      </dl>
      ${actionButtons(profile)}
    </section>
  `;
}

function actionButtons(profile) {
  return `
    <div class="admin-actions">
      ${profile.status === 'pending' ? `<button class="admin-button" data-status="${profile.id}:active">Valider</button>` : ''}
      ${profile.status === 'active' ? `<button class="admin-danger" data-status="${profile.id}:blocked">Bloquer</button>` : ''}
      ${profile.status === 'blocked' ? `<button class="admin-button" data-status="${profile.id}:active">Débloquer</button>` : ''}
      <button class="admin-secondary" data-rename="${profile.id}" data-current-name="${escapeAttribute(profile.prenom || '')}">Modifier prénom</button>
      <button class="admin-secondary" data-reset-password="${profile.id}">Réinitialiser mot de passe</button>
    </div>
  `;
}

function bindUserActions() {
  document.querySelectorAll('[data-status]').forEach((button) => {
    button.addEventListener('click', async () => {
      const [userId, status] = button.dataset.status.split(':');
      await runAction(() => updateUserStatus(userId, status), 'Statut mis à jour');
    });
  });
  document.querySelectorAll('[data-rename]').forEach((button) => {
    button.addEventListener('click', () => openPrompt({
      title: 'Modifier le prénom',
      label: 'Prénom',
      value: button.dataset.currentName || '',
      onSubmit: async (value) => {
        const prenom = value.trim();
        if (!prenom) throw new Error('Prénom requis');
        await runAction(() => renameUser(button.dataset.rename, prenom), 'Prénom modifié');
      }
    }));
  });
  document.querySelectorAll('[data-reset-password]').forEach((button) => {
    button.addEventListener('click', () => openPrompt({
      title: 'Réinitialiser le mot de passe',
      label: 'Nouveau mot de passe temporaire',
      type: 'password',
      onSubmit: async (value) => {
        if (value.length < 6) throw new Error('Minimum 6 caractères');
        await runAction(() => resetUserPassword(button.dataset.resetPassword, value), 'Mot de passe réinitialisé');
      }
    }));
  });
}

async function runAction(fn, successMessage, rerender = true) {
  try {
    await fn();
    await refreshData();
    toast(successMessage);
    if (rerender) render();
  } catch (error) {
    toast(error.message || 'Action refusée', true);
  }
}

function openPrompt({ title, label, value = '', onSubmit, type = 'text' }) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-backdrop">
      <form class="admin-modal" data-prompt-form>
        <h2>${escapeHTML(title)}</h2>
        <label>${escapeHTML(label)}<input type="${type}" name="value" value="${escapeAttribute(value)}" required></label>
        <div class="admin-actions">
          <button class="admin-secondary" type="button" data-close-modal>Annuler</button>
          <button class="admin-button" type="submit">Confirmer</button>
        </div>
      </form>
    </div>
  `;
  root.querySelector('[data-close-modal]').addEventListener('click', () => root.innerHTML = '');
  root.querySelector('[data-prompt-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    await onSubmit(new FormData(event.currentTarget).get('value'));
    root.innerHTML = '';
  });
}

function latestProfile(profile) {
  return `
    <div class="latest-item">
      <div><strong>${escapeHTML(profile.prenom || 'Élève')}</strong><span>${escapeHTML(profile.telephone || '')}</span></div>
      <span class="badge ${escapeAttribute(profile.status)}">${statusLabel(profile.status)}</span>
    </div>
  `;
}

function countProfiles() {
  return {
    total: state.profiles.length,
    pending: state.profiles.filter((p) => p.status === 'pending').length,
    active: state.profiles.filter((p) => p.status === 'active').length,
    blocked: state.profiles.filter((p) => p.status === 'blocked').length
  };
}

function filteredProfiles() {
  const q = state.query.trim().toLowerCase();
  return state.profiles.filter((profile) => {
    const matchesFilter = state.filter === 'all' || profile.status === state.filter;
    const text = `${profile.prenom || ''} ${profile.telephone || ''}`.toLowerCase();
    return matchesFilter && text.includes(q);
  });
}

function setView(html) {
  document.getElementById('admin-view').innerHTML = html;
}

function metric(label, value) {
  return `<section class="admin-card metric"><span>${escapeHTML(label)}</span><strong>${Number(value) || 0}</strong></section>`;
}

function statusLabel(status) {
  return { all: 'Tous', pending: 'En attente', active: 'Actifs', blocked: 'Bloqués' }[status] || status || '';
}

function toast(message, isError = false) {
  const root = document.getElementById('toast-root');
  root.innerHTML = `<div class="toast ${isError ? 'error' : ''}">${escapeHTML(message)}</div>`;
  clearTimeout(root.timer);
  root.timer = setTimeout(() => root.innerHTML = '', 3000);
}

function formatPrice(value) {
  return `${Number(value || 0).toLocaleString('fr-FR')} FCFA`;
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function escapeAttribute(value) {
  return escapeHTML(value);
}
