import { requireAuthenticatedUser, logoutCurrentUser, resolveLocalDevUser } from './services/auth-service.js';
import {
  forceStudentsLogout,
  forceUserLogout,
  loadAdminOverview,
  renameUser,
  resetUserPassword,
  sendNotification,
  updateAppSettings,
  updateUserStatus
} from './services/admin-service.js';

const state = {
  currentView: 'dashboard',
  currentUser: null,
  profiles: [],
  settings: {},
  notifications: [],
  auditLogs: [],
  securityEvents: [],
  filter: 'all',
  query: ''
};

document.addEventListener('DOMContentLoaded', initAdmin);

async function initAdmin() {
  document.getElementById('admin-view').innerHTML = '<section class="admin-card">Chargement du centre de contrôle...</section>';
  const dev = resolveLocalDevUser();
  if (dev?.isAdmin) {
    state.currentUser = dev;
    state.profiles = [];
    state.settings = {
      maintenance_enabled: false,
      examen_poids_leger_enabled: false,
      examen_poids_lourd_enabled: false
    };
    state.notifications = [];
    state.auditLogs = [];
    state.securityEvents = [];
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
  await loadData();
  bindShell();
  render();
}

async function loadData() {
  const overview = await loadAdminOverview();
  state.profiles = overview.profiles || [];
  state.settings = overview.settings || {};
  state.notifications = overview.notifications || [];
  state.auditLogs = overview.auditLogs || [];
  state.securityEvents = overview.securityEvents || [];
  renderServiceStatus();
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

function render() {
  document.querySelectorAll('[data-admin-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.adminView === state.currentView);
  });
  const views = {
    dashboard: renderDashboard,
    users: renderUsers,
    messages: renderMessages,
    application: renderApplication,
    security: renderSecurity,
    journal: renderJournal
  };
  views[state.currentView]();
}

function renderDashboard() {
  const counts = countProfiles();
  setView(`
    <section class="admin-view">
      <div class="admin-heading">
        <div><p class="eyebrow">Control Center</p><h1>Bonsoir, Administrateur</h1></div>
        ${servicePill()}
      </div>
      <div class="admin-grid metrics">
        ${metric('Utilisateurs', counts.total)}
        ${metric('Actifs', counts.active)}
        ${metric('À valider', counts.pending)}
        ${metric('Bloqués', counts.blocked)}
        ${metric('Messages actifs', activeNotificationsCount())}
        ${metric('Alertes sécurité', state.securityEvents.length)}
      </div>
      <div class="admin-grid metrics">
        <button class="admin-card" data-admin-view-short="users"><strong>Valider inscriptions</strong><span>Ouvrir utilisateurs</span></button>
        <button class="admin-card" data-admin-view-short="messages"><strong>Envoyer annonce</strong><span>Messages</span></button>
        <button class="admin-card" data-admin-view-short="application"><strong>Maintenance</strong><span>Paramètres service</span></button>
        <button class="admin-card" data-admin-view-short="security"><strong>Voir alertes</strong><span>Sécurité</span></button>
      </div>
      <section class="admin-card">
        <h2>Examens</h2>
        <p>Permis B : ${state.settings.examen_poids_leger_enabled ? 'Actif' : 'En correction'}</p>
        <p>Permis C : ${state.settings.examen_poids_lourd_enabled ? 'Actif' : 'En correction'}</p>
      </section>
    </section>
  `);
  document.querySelectorAll('[data-admin-view-short]').forEach((button) => {
    button.addEventListener('click', () => {
      state.currentView = button.dataset.adminViewShort;
      render();
    });
  });
}

function renderUsers() {
  const profiles = filteredProfiles();
  setView(`
    <section class="admin-view">
      <div class="admin-heading"><div><p class="eyebrow">Gestion</p><h1>Utilisateurs</h1></div>${servicePill()}</div>
      <section class="admin-card admin-form">
        <label>Recherche
          <input data-user-search placeholder="Nom, téléphone, statut" value="${escapeAttribute(state.query)}">
        </label>
        <label>Filtre
          <select data-user-filter>
            ${['all', 'active', 'pending', 'blocked'].map((status) => `<option value="${status}" ${state.filter === status ? 'selected' : ''}>${statusLabel(status)}</option>`).join('')}
          </select>
        </label>
      </section>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>Nom</th><th>Téléphone</th><th>Statut</th><th>Inscription</th><th>Actions</th></tr></thead>
          <tbody>
            ${profiles.map(userRow).join('') || '<tr><td colspan="5">Aucun utilisateur</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
  `);
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
      <td><span class="badge ${escapeAttribute(profile.status)}">${statusLabel(profile.status)}</span></td>
      <td>${formatDate(profile.created_at)}</td>
      <td><div class="admin-actions">
        <button class="admin-secondary" data-rename="${profile.id}">Modifier nom</button>
        ${profile.status !== 'active' ? `<button class="admin-button" data-status="${profile.id}:active">Valider</button>` : ''}
        ${profile.status !== 'blocked' ? `<button class="admin-danger" data-status="${profile.id}:blocked">Bloquer</button>` : `<button class="admin-button" data-status="${profile.id}:active">Débloquer</button>`}
        <button class="admin-secondary" data-reset-password="${profile.id}">Réinitialiser MDP</button>
        <button class="admin-danger" data-force-logout="${profile.id}">Déconnecter</button>
        <button class="admin-secondary" data-message-user="${profile.id}">Message</button>
      </div></td>
    </tr>
  `;
}

function bindUserActions() {
  document.querySelectorAll('[data-status]').forEach((button) => {
    button.addEventListener('click', async () => {
      const [userId, status] = button.dataset.status.split(':');
      if (status === 'blocked' && !confirm('Bloquer cet utilisateur ?')) return;
      await runAction(() => updateUserStatus(userId, status), 'Statut mis à jour');
    });
  });
  document.querySelectorAll('[data-rename]').forEach((button) => {
    button.addEventListener('click', () => openPrompt('Modifier le nom', 'Prénom', '', async (value) => {
      await runAction(() => renameUser(button.dataset.rename, value), 'Nom modifié');
    }));
  });
  document.querySelectorAll('[data-reset-password]').forEach((button) => {
    button.addEventListener('click', () => openPrompt('Réinitialiser le mot de passe', 'Nouveau mot de passe temporaire', '', async (value) => {
      if (value.length < 6) throw new Error('Minimum 6 caractères');
      await runAction(() => resetUserPassword(button.dataset.resetPassword, value), 'Mot de passe réinitialisé');
    }, 'password'));
  });
  document.querySelectorAll('[data-force-logout]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('Déconnecter cet utilisateur de ses appareils ?')) return;
      await runAction(() => forceUserLogout(button.dataset.forceLogout), 'Session utilisateur invalidée');
    });
  });
  document.querySelectorAll('[data-message-user]').forEach((button) => {
    button.addEventListener('click', () => {
      state.currentView = 'messages';
      renderMessages(button.dataset.messageUser);
    });
  });
}

function renderMessages(targetUserId = '') {
  setView(`
    <section class="admin-view">
      <div class="admin-heading"><div><p class="eyebrow">Communication</p><h1>Messages</h1></div>${servicePill()}</div>
      <form class="admin-card admin-form" data-message-form>
        <label>Destinataire
          <select name="target_user_id">
            <option value="">Message global</option>
            ${state.profiles.map((p) => `<option value="${p.id}" ${targetUserId === p.id ? 'selected' : ''}>${escapeHTML(p.prenom || 'Élève')} - ${escapeHTML(p.telephone || '')}</option>`).join('')}
          </select>
        </label>
        <label>Titre <input name="title" required></label>
        <label>Message <textarea name="message" required></textarea></label>
        <label>Type
          <select name="type"><option>information</option><option>important</option><option>maintenance</option><option>success</option></select>
        </label>
        <label>Date début <input name="starts_at" type="datetime-local"></label>
        <label>Expiration facultative <input name="expires_at" type="datetime-local"></label>
        <label>Confirmation obligatoire
          <select name="requires_ack"><option value="false">Non</option><option value="true">Oui</option></select>
        </label>
        <button class="admin-button" type="submit">Envoyer le message</button>
      </form>
    </section>
  `);
  document.querySelector('[data-message-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await runAction(() => sendNotification(Object.fromEntries(form.entries())), 'Message envoyé');
  });
}

function renderApplication() {
  setView(`
    <section class="admin-view">
      <div class="admin-heading"><div><p class="eyebrow">Produit</p><h1>Application</h1></div>${servicePill()}</div>
      <form class="admin-card admin-form" data-settings-form>
        <h2>Maintenance</h2>
        <label>État du service
          <select name="maintenance_enabled">
            <option value="false" ${!state.settings.maintenance_enabled ? 'selected' : ''}>Site ouvert</option>
            <option value="true" ${state.settings.maintenance_enabled ? 'selected' : ''}>Site en maintenance</option>
          </select>
        </label>
        <label>Titre maintenance <input name="maintenance_title" value="${escapeAttribute(state.settings.maintenance_title || 'Maintenance en cours')}"></label>
        <label>Message maintenance <textarea name="maintenance_message">${escapeHTML(state.settings.maintenance_message || '')}</textarea></label>
        <label>Fin prévue <input type="datetime-local" name="maintenance_until"></label>
        <h2>Coordonnées</h2>
        <label>Nom auto-école <input name="school_name" value="${escapeAttribute(state.settings.school_name || window.APP_CONFIG.schoolName)}"></label>
        <label>Téléphone <input name="support_phone" value="${escapeAttribute(state.settings.support_phone || window.CONTACT_CONFIG.phone)}"></label>
        <label>WhatsApp <input name="whatsapp_phone" value="${escapeAttribute(state.settings.whatsapp_phone || window.CONTACT_CONFIG.whatsapp)}"></label>
        <label>Email support <input name="support_email" value="${escapeAttribute(state.settings.support_email || window.CONTACT_CONFIG.email)}"></label>
        <h2>Examens</h2>
        <label>Permis B
          <select name="examen_poids_leger_enabled"><option value="false">En correction</option><option value="true">Actif</option></select>
        </label>
        <label>Permis C
          <select name="examen_poids_lourd_enabled"><option value="false">En correction</option><option value="true">Actif</option></select>
        </label>
        <h2>Annonce Home</h2>
        <label>Titre <input name="announcement_title" value="${escapeAttribute(state.settings.announcement_title || '')}"></label>
        <label>Message <textarea name="announcement_message">${escapeHTML(state.settings.announcement_message || '')}</textarea></label>
        <label>Expiration <input type="datetime-local" name="announcement_expires_at"></label>
        <button class="admin-button" type="submit">Enregistrer</button>
      </form>
    </section>
  `);
  document.querySelector('[data-settings-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const settings = Object.fromEntries(form.entries());
    settings.maintenance_enabled = settings.maintenance_enabled === 'true';
    settings.examen_poids_leger_enabled = settings.examen_poids_leger_enabled === 'true';
    settings.examen_poids_lourd_enabled = settings.examen_poids_lourd_enabled === 'true';
    if (settings.maintenance_enabled && !confirm('Activer la maintenance pour les élèves ?')) return;
    await runAction(() => updateAppSettings(settings), 'Paramètres enregistrés');
  });
}

function renderSecurity() {
  setView(`
    <section class="admin-view">
      <div class="admin-heading"><div><p class="eyebrow">Sécurité</p><h1>Sécurité</h1></div>${servicePill()}</div>
      <section class="admin-card admin-actions">
        <button class="admin-danger" data-force-all>Déconnecter tous les élèves</button>
      </section>
      <section class="admin-card">
        <h2>Événements récents</h2>
        ${state.securityEvents.map((event) => `<p>${formatDateTime(event.created_at)} · ${escapeHTML(event.event_type)} · ${escapeHTML(event.severity)}</p>`).join('') || '<p>Aucun événement récent.</p>'}
      </section>
    </section>
  `);
  document.querySelector('[data-force-all]').addEventListener('click', async () => {
    const value = prompt('Tapez DECONNECTER pour confirmer.');
    if (value !== 'DECONNECTER') return;
    await runAction(() => forceStudentsLogout(value), 'Tous les élèves devront se reconnecter');
  });
}

function renderJournal() {
  setView(`
    <section class="admin-view">
      <div class="admin-heading"><div><p class="eyebrow">Audit</p><h1>Journal</h1></div>${servicePill()}</div>
      <section class="admin-card">
        ${state.auditLogs.map((log) => `<p>${formatDateTime(log.created_at)} · ${escapeHTML(log.action)} · ${escapeHTML(log.target_user_id || '')}</p>`).join('') || '<p>Aucune action auditée.</p>'}
      </section>
    </section>
  `);
}

function setView(html) {
  document.getElementById('admin-view').innerHTML = html;
}

async function runAction(fn, successMessage) {
  try {
    await fn();
    await loadData();
    toast(successMessage);
    render();
  } catch (error) {
    toast(error.message || 'Action refusée', true);
  }
}

function openPrompt(title, label, value, onSubmit, type = 'text') {
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

function countProfiles() {
  return {
    total: state.profiles.length,
    active: state.profiles.filter((p) => p.status === 'active').length,
    pending: state.profiles.filter((p) => p.status === 'pending').length,
    blocked: state.profiles.filter((p) => p.status === 'blocked').length
  };
}

function filteredProfiles() {
  const q = state.query.toLowerCase();
  return state.profiles.filter((profile) => {
    const matchesFilter = state.filter === 'all' || profile.status === state.filter;
    const text = `${profile.prenom || ''} ${profile.telephone || ''} ${profile.status || ''}`.toLowerCase();
    return matchesFilter && text.includes(q);
  });
}

function activeNotificationsCount() {
  return state.notifications.length;
}

function servicePill() {
  const maintenance = Boolean(state.settings.maintenance_enabled);
  return `<span class="status-pill"><span class="status-dot ${maintenance ? 'maintenance' : ''}"></span>${maintenance ? 'Maintenance' : 'En ligne'}</span>`;
}

function renderServiceStatus() {
  const el = document.querySelector('[data-service-status]');
  if (el) el.innerHTML = servicePill();
}

function metric(label, value) {
  return `<section class="admin-card metric"><span>${escapeHTML(label)}</span><strong>${Number(value) || 0}</strong></section>`;
}

function statusLabel(status) {
  return { all: 'Tous', active: 'Actifs', pending: 'En attente', blocked: 'Bloqués' }[status] || status;
}

function toast(message, isError = false) {
  const root = document.getElementById('toast-root');
  root.innerHTML = `<div class="toast" style="background:${isError ? 'var(--danger)' : 'var(--navy-950)'}">${escapeHTML(message)}</div>`;
  clearTimeout(root.timer);
  root.timer = setTimeout(() => root.innerHTML = '', 3000);
}

function formatDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('fr-FR').format(new Date(value));
}

function formatDateTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
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
