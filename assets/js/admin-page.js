import { requireAuthenticatedUser, logoutCurrentUser, resolveLocalDevUser } from './services/auth-service.js';
import { loadAdminOverview, renameUser, resetUserPassword, updateUserStatus } from './services/admin-service.js';
import { EXAM_LIGHT_DATA } from './data/exam-light-data.js';
import { EXAM_HEAVY_DATA } from './data/exam-heavy-data.js';
import {
  getExamImageRules,
  loadExamImageOverrides,
  loadExamSettings,
  restoreQuestionOriginalImage,
  updateExamStatus,
  uploadQuestionImage,
  validateExamImageFile
} from './services/exam-service.js';

const EXAMS = {
  light: EXAM_LIGHT_DATA,
  heavy: EXAM_HEAVY_DATA
};

const EXAM_LABELS = {
  light: 'Poids Léger',
  heavy: 'Poids Lourd'
};

const EXAM_STATUS_LABELS = {
  verification: 'En vérification',
  online: 'En ligne',
  offline: 'Hors ligne'
};

const state = {
  currentView: 'dashboard',
  currentUser: null,
  profiles: [],
  filter: 'all',
  query: '',
  examKey: 'light',
  examQuery: '',
  examSeries: 'all',
  examSettings: [],
  examOverrides: {
    light: new Map(),
    heavy: new Map()
  }
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
  const [overview, examSettings, lightOverrides, heavyOverrides] = await Promise.all([
    loadAdminOverview(),
    loadExamSettings({ force: true }),
    loadExamImageOverrides('light', { force: true }),
    loadExamImageOverrides('heavy', { force: true })
  ]);
  state.profiles = overview.profiles || [];
  state.examSettings = examSettings || [];
  state.examOverrides.light = lightOverrides;
  state.examOverrides.heavy = heavyOverrides;
}

function render() {
  document.querySelectorAll('[data-admin-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.adminView === state.currentView);
  });
  if (state.currentView === 'users') {
    renderUsers();
  } else if (state.currentView === 'exams') {
    renderExams();
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
          <button class="admin-secondary" type="button" data-preview-exam="light">Accéder Poids Léger</button>
          <button class="admin-secondary" type="button" data-preview-exam="heavy">Accéder Poids Lourd</button>
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

function renderExams() {
  const exam = getSelectedExam();
  const questions = filteredExamQuestions(exam);
  const setting = getSelectedExamSetting();
  setView(`
    <section class="admin-view">
      <div class="admin-heading">
        <div>
          <p class="eyebrow">Gestion des examens</p>
          <h1>Examens</h1>
        </div>
        <button class="admin-secondary" type="button" data-refresh>Actualiser</button>
      </div>
      <div class="exam-tabs" role="tablist">
        ${Object.keys(EXAMS).map((examKey) => `
          <button class="${state.examKey === examKey ? 'active' : ''}" type="button" data-exam-tab="${examKey}">
            ${escapeHTML(EXAM_LABELS[examKey])}
          </button>
        `).join('')}
      </div>
      <section class="admin-card admin-form exam-admin-toolbar">
        <label>Recherche
          <input data-exam-search placeholder="ID ou texte question" value="${escapeAttribute(state.examQuery)}">
        </label>
        <label>Série
          <select data-exam-series-filter>
            <option value="all" ${state.examSeries === 'all' ? 'selected' : ''}>Toutes</option>
            ${exam.series.map((series) => `<option value="${escapeAttribute(series.id)}" ${state.examSeries === series.id ? 'selected' : ''}>${escapeHTML(series.id)}</option>`).join('')}
          </select>
        </label>
        <label>Statut
          <select data-exam-status>
            ${Object.entries(EXAM_STATUS_LABELS).map(([value, label]) => `<option value="${value}" ${setting.status === value ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </label>
        <button class="admin-button" type="button" data-save-exam-status>Enregistrer statut</button>
      </section>
      <div class="exam-admin-summary">
        <span>${questions.length} question${questions.length > 1 ? 's' : ''}</span>
        <span>${countOverrides(state.examKey)} image${countOverrides(state.examKey) > 1 ? 's' : ''} personnalisée${countOverrides(state.examKey) > 1 ? 's' : ''}</span>
      </div>
      <div class="exam-question-admin-list">
        ${questions.map(renderExamQuestionCard).join('') || '<section class="admin-card">Aucune question trouvée.</section>'}
      </div>
    </section>
  `);
  bindExamActions();
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

function bindExamActions() {
  document.querySelector('[data-refresh]').addEventListener('click', async () => {
    await runAction(refreshData, 'Données actualisées', false);
    renderExams();
  });
  document.querySelectorAll('[data-exam-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.examKey = button.dataset.examTab;
      state.examSeries = 'all';
      renderExams();
    });
  });
  document.querySelector('[data-exam-search]').addEventListener('input', (event) => {
    state.examQuery = event.target.value;
    renderExams();
  });
  document.querySelector('[data-exam-series-filter]').addEventListener('change', (event) => {
    state.examSeries = event.target.value;
    renderExams();
  });
  document.querySelector('[data-save-exam-status]').addEventListener('click', async () => {
    const status = document.querySelector('[data-exam-status]').value;
    await runAction(async () => {
      await updateExamStatus(state.examKey, status);
      state.examSettings = await loadExamSettings({ force: true });
    }, 'Statut examen mis à jour');
  });
  document.querySelectorAll('[data-upload-question-image]').forEach((button) => {
    button.addEventListener('click', () => openImagePicker(button.dataset.uploadQuestionImage));
  });
  document.querySelectorAll('[data-restore-question-image]').forEach((button) => {
    button.addEventListener('click', () => confirmRestoreImage(button.dataset.restoreQuestionImage));
  });
}

function renderExamQuestionCard(question) {
  const override = state.examOverrides[state.examKey].get(question.id);
  const image = override?.publicUrl || question.image || '';
  const sourceLabel = override ? 'Personnalisée' : 'Originale';
  return `
    <article class="admin-card exam-question-admin-card">
      <div class="exam-question-admin-image">
        ${image ? `<img src="${escapeAttribute(image)}" alt="">` : '<div class="exam-image-empty">Aucune image</div>'}
      </div>
      <div class="exam-question-admin-body">
        <div class="exam-question-admin-head">
          <div>
            <strong>${escapeHTML(question.id)}</strong>
            <span>${escapeHTML(question.seriesId)} · Question ${Number(question.number) || ''}</span>
          </div>
          <span class="badge ${override ? 'custom' : 'original'}">${sourceLabel}</span>
        </div>
        <div class="exam-readonly-field">
          <span>Question</span>
          <p>${escapeHTML(question.text || 'Question sans texte')}</p>
        </div>
        <div class="exam-readonly-field">
          <span>Image</span>
          <code>${escapeHTML(override?.storage_path || question.image || 'Aucune image')}</code>
        </div>
        <div class="admin-actions">
          <button class="admin-button" type="button" data-upload-question-image="${escapeAttribute(question.id)}">Remplacer l'image</button>
          ${override ? `<button class="admin-secondary" type="button" data-restore-question-image="${escapeAttribute(question.id)}">Restaurer l'image originale</button>` : ''}
        </div>
      </div>
    </article>
  `;
}

function openImagePicker(questionId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = getExamImageRules().allowedTypes.join(',');
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) openUploadPreview(questionId, file);
  }, { once: true });
  input.click();
}

function openUploadPreview(questionId, file) {
  try {
    validateExamImageFile(file);
  } catch (error) {
    toast(error.message, true);
    return;
  }
  const question = findQuestion(questionId);
  if (!question) return;
  const previewUrl = URL.createObjectURL(file);
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-backdrop">
      <form class="admin-modal upload-modal" data-upload-form>
        <h2>Remplacer l'image</h2>
        <p>${escapeHTML(question.id)} · ${escapeHTML(question.seriesId)} · Question ${Number(question.number) || ''}</p>
        <img class="upload-preview" src="${escapeAttribute(previewUrl)}" alt="">
        <small>${escapeHTML(file.name)} · ${formatFileSize(file.size)}</small>
        <div class="admin-actions">
          <button class="admin-secondary" type="button" data-close-modal>Annuler</button>
          <button class="admin-button" type="submit">Enregistrer</button>
        </div>
      </form>
    </div>
  `;
  root.querySelector('[data-close-modal]').addEventListener('click', () => {
    URL.revokeObjectURL(previewUrl);
    root.innerHTML = '';
  });
  root.querySelector('[data-upload-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await uploadQuestionImage({
        examKey: state.examKey,
        questionId: question.id,
        seriesId: question.seriesId,
        file
      });
      state.examOverrides[state.examKey] = await loadExamImageOverrides(state.examKey, { force: true });
      URL.revokeObjectURL(previewUrl);
      root.innerHTML = '';
      toast('Image mise à jour.');
      renderExams();
    } catch (error) {
      toast(error.message || 'Upload refusé', true);
    }
  });
}

function confirmRestoreImage(questionId) {
  const question = findQuestion(questionId);
  if (!question) return;
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="admin-modal">
        <h2>Restaurer l'image d'origine ?</h2>
        <p>${escapeHTML(question.id)} utilisera à nouveau l'image originale du repository.</p>
        <div class="admin-actions">
          <button class="admin-secondary" type="button" data-close-modal>Annuler</button>
          <button class="admin-danger" type="button" data-confirm-restore>Restaurer</button>
        </div>
      </div>
    </div>
  `;
  root.querySelector('[data-close-modal]').addEventListener('click', () => root.innerHTML = '');
  root.querySelector('[data-confirm-restore]').addEventListener('click', async () => {
    try {
      await restoreQuestionOriginalImage(state.examKey, question.id);
      state.examOverrides[state.examKey] = await loadExamImageOverrides(state.examKey, { force: true });
      root.innerHTML = '';
      toast('Image originale restaurée.');
      renderExams();
    } catch (error) {
      toast(error.message || 'Restauration refusée', true);
    }
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

function getSelectedExam() {
  return EXAMS[state.examKey] || EXAMS.light;
}

function getSelectedExamSetting() {
  return state.examSettings.find((setting) => setting.exam_key === state.examKey) || { exam_key: state.examKey, status: 'verification' };
}

function getAllExamQuestions(exam) {
  return exam.series.flatMap((series) => series.questions);
}

function filteredExamQuestions(exam) {
  const q = state.examQuery.trim().toLowerCase();
  return getAllExamQuestions(exam).filter((question) => {
    const matchesSeries = state.examSeries === 'all' || question.seriesId === state.examSeries;
    const text = `${question.id} ${question.text || ''}`.toLowerCase();
    return matchesSeries && (!q || text.includes(q));
  });
}

function findQuestion(questionId) {
  return getAllExamQuestions(getSelectedExam()).find((question) => question.id === questionId);
}

function countOverrides(examKey) {
  return state.examOverrides[examKey]?.size || 0;
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

function formatFileSize(value) {
  return `${(Number(value || 0) / 1024 / 1024).toFixed(2)} Mo`;
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
