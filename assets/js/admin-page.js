import { requireAuthenticatedUser, logoutCurrentUser, resolveLocalDevUser } from './services/auth-service.js';
import { loadAdminOverview, renameUser, resetUserPassword, updateUserStatus } from './services/admin-service.js';
import { loadRuntimeSettings, updateRuntimeMaintenance } from './services/runtime-service.js';
import { CMS_UNAVAILABLE_MESSAGE, loadCmsOverview } from './services/content-service.js';
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

const EXAM_NAV_ORIGIN_KEY = 'examNavigationOrigin';
const EXAM_ADMIN_RETURN_SECTION_KEY = 'examAdminReturnSection';

const state = {
  currentView: 'dashboard',
  currentUser: null,
  profiles: [],
  userTotal: 0,
  userCounts: { total: 0, pending: 0, active: 0, blocked: 0 },
  userPage: 1,
  userPageSize: 10,
  filter: 'all',
  query: '',
  examKey: 'light',
  examQuery: '',
  examSeries: 'all',
  examSettings: [],
  examOverrides: {
    light: new Map(),
    heavy: new Map()
  },
  examBackendConfigured: true,
  examBackendError: '',
  runtimeSettings: {
    maintenance_enabled: false,
    maintenance_message: ''
  },
  cmsOverview: null,
  cmsLoading: false
};

document.addEventListener('DOMContentLoaded', initAdmin);

async function initAdmin() {
  setView('<section class="admin-card">Chargement admin...</section>');
  state.currentView = resolveInitialView();

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
  await loadInitialAdminData();
  render();
}

async function loadInitialAdminData() {
  const users = await settleAdminLoad(refreshUsers, 'Chargement utilisateurs');
  const secondary = await Promise.allSettled([
    refreshExams({ silent: true }),
    refreshRuntimeSettings()
  ]);
  secondary.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.warn(index === 0 ? 'Chargement examens échoué' : 'Chargement maintenance échoué', result.reason);
    }
  });
  return users;
}

async function settleAdminLoad(loader, label) {
  try {
    return await loader();
  } catch (error) {
    console.error(`${label} échoué`, error);
    toast(`${label} indisponible`, true);
    return null;
  }
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

async function refreshUsers() {
  const overview = await loadAdminOverview({
    page: state.userPage,
    pageSize: state.userPageSize,
    status: state.filter,
    query: state.query
  });
  state.profiles = overview.profiles || [];
  state.userTotal = overview.total || 0;
  state.userCounts = overview.counts || countProfilesFromPage();
  return overview;
}

async function refreshRuntimeSettings() {
  state.runtimeSettings = await loadRuntimeSettings({ force: true });
  return state.runtimeSettings;
}

async function refreshExams({ silent = false } = {}) {
  try {
    const [examSettings, lightOverrides, heavyOverrides] = await Promise.all([
      loadExamSettings({ force: true }),
      loadExamImageOverrides('light', { force: true }),
      loadExamImageOverrides('heavy', { force: true })
    ]);
    state.examBackendConfigured = true;
    state.examBackendError = '';
    state.examSettings = examSettings || [];
    state.examOverrides.light = lightOverrides;
    state.examOverrides.heavy = heavyOverrides;
  } catch (error) {
    state.examBackendConfigured = false;
    state.examBackendError = error.message || 'Configuration examens indisponible';
    state.examSettings = [
      { exam_key: 'light', status: 'verification' },
      { exam_key: 'heavy', status: 'verification' }
    ];
    state.examOverrides.light = new Map();
    state.examOverrides.heavy = new Map();
    if (!silent && state.currentView === 'exams') renderExams();
  }
}

async function refreshCurrentViewData() {
  if (state.currentView === 'exams') {
    await refreshExams();
    return;
  }
  if (isCmsView(state.currentView)) {
    await refreshCmsOverview();
    return;
  }
  await refreshUsers();
}

function render() {
  document.querySelectorAll('[data-admin-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.adminView === state.currentView);
  });
  if (state.currentView === 'users') {
    renderUsers();
  } else if (state.currentView === 'exams') {
    renderExams();
  } else if (isCmsView(state.currentView)) {
    renderCmsSection(state.currentView);
  } else {
    renderDashboard();
  }
}

async function refreshCmsOverview({ force = true } = {}) {
  state.cmsLoading = true;
  try {
    state.cmsOverview = await loadCmsOverview({ force });
  } catch (error) {
    console.warn('Chargement CMS échoué', error);
    state.cmsOverview = {
      available: false,
      examSeriesCount: 0,
      lessonsCount: 0,
      panelsCount: 0,
      mediaCount: 0,
      error: error.message || 'Tables CMS indisponibles'
    };
  } finally {
    state.cmsLoading = false;
  }
  return state.cmsOverview;
}

function renderDashboard() {
  const counts = countProfiles();
  const latest = [...state.profiles].slice(0, 6);
  const maintenance = state.runtimeSettings?.maintenance_enabled;
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
      <section class="admin-card admin-form maintenance-card">
        <div class="card-heading">
          <h2>Mode maintenance</h2>
          <span class="badge ${maintenance ? 'pending' : 'active'}">${maintenance ? 'Maintenance active' : 'Site en ligne'}</span>
        </div>
        <label class="admin-switch">
          <input type="checkbox" data-maintenance-enabled ${maintenance ? 'checked' : ''}>
          <span>Activer le mode maintenance</span>
        </label>
        <label>Message
          <textarea data-maintenance-message>${escapeHTML(state.runtimeSettings?.maintenance_message || '')}</textarea>
        </label>
        <div class="admin-actions">
          <button class="admin-button" type="button" data-save-maintenance>${maintenance ? 'Désactiver la maintenance' : 'Activer la maintenance'}</button>
        </div>
      </section>
      <section class="admin-card">
        <div class="card-heading">
          <h2>Examens en correction</h2>
        </div>
        <div class="admin-actions">
          <button class="admin-secondary" type="button" data-open-exam="light">Accéder Poids Léger</button>
          <button class="admin-secondary" type="button" data-open-exam="heavy">Accéder Poids Lourd</button>
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
    await runAction(refreshUsers, 'Données actualisées', false, { refreshAfter: false, button: document.querySelector('[data-refresh]') });
  });
  document.querySelector('[data-open-users]').addEventListener('click', () => {
    state.currentView = 'users';
    render();
  });
  document.querySelectorAll('[data-open-exam]').forEach((button) => {
    button.addEventListener('click', () => {
      const examId = button.dataset.openExam;
      if (window.canAccessExam?.(examId, state.currentUser)) {
        openExamInSpa(examId);
      }
    });
  });
  document.querySelector('[data-save-maintenance]').addEventListener('click', saveMaintenanceSettings);
}

function renderExams() {
  const exam = getSelectedExam();
  const questions = filteredExamQuestions(exam);
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
      ${state.examBackendConfigured ? '' : `
        <section class="admin-card exam-backend-notice">
          <strong>Le module de gestion des examens n'est pas encore configuré sur le backend.</strong>
          <span>Les tables Supabase examens ne sont pas encore disponibles. Les utilisateurs restent gérés normalement.</span>
        </section>
      `}
      <div class="exam-publish-grid">
        ${Object.keys(EXAMS).map(renderExamPublishCard).join('')}
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
        <button class="admin-secondary" type="button" data-open-selected-exam>Ouvrir l'examen</button>
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

function renderExamPublishCard(examKey) {
  const setting = getExamSetting(examKey);
  const isOnline = setting.status === 'online';
  return `
    <section class="admin-card exam-publish-card">
      <div>
        <strong>${escapeHTML(EXAM_LABELS[examKey])}</strong>
        <span>${isOnline ? 'Disponible aux élèves' : 'En vérification'}</span>
      </div>
      <label class="admin-switch">
        <input type="checkbox" data-exam-availability="${escapeAttribute(examKey)}" ${isOnline ? 'checked' : ''} ${state.examBackendConfigured ? '' : 'disabled'}>
        <span>Disponible aux élèves : ${isOnline ? 'ON' : 'OFF'}</span>
      </label>
      <button class="admin-secondary" type="button" data-open-exam-preview="${escapeAttribute(examKey)}">Ouvrir l'examen</button>
    </section>
  `;
}

function renderUsers() {
  const profiles = state.profiles;
  const pageCount = Math.max(1, Math.ceil(state.userTotal / state.userPageSize));
  const start = state.userTotal ? ((state.userPage - 1) * state.userPageSize) + 1 : 0;
  const end = Math.min(state.userPage * state.userPageSize, state.userTotal);
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
      <div class="admin-pagination">
        <span>${start}–${end} sur ${state.userTotal} utilisateur${state.userTotal > 1 ? 's' : ''}</span>
        <div class="admin-actions">
          <button class="admin-secondary" type="button" data-user-page="prev" ${state.userPage <= 1 ? 'disabled' : ''}>← Précédent</button>
          <span>Page ${state.userPage} sur ${pageCount}</span>
          <button class="admin-secondary" type="button" data-user-page="next" ${state.userPage >= pageCount ? 'disabled' : ''}>Suivant →</button>
        </div>
      </div>
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
    await runAction(refreshUsers, 'Données actualisées', false, { refreshAfter: false, button: document.querySelector('[data-refresh]') });
    renderUsers();
  });
  document.querySelector('[data-user-search]').addEventListener('input', (event) => {
    state.query = event.target.value;
    state.userPage = 1;
    refreshUsers().then(renderUsers).catch((error) => toast(error.message || 'Chargement refusé', true));
  });
  document.querySelector('[data-user-filter]').addEventListener('change', (event) => {
    state.filter = event.target.value;
    state.userPage = 1;
    refreshUsers().then(renderUsers).catch((error) => toast(error.message || 'Chargement refusé', true));
  });
  document.querySelectorAll('[data-user-page]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      setButtonBusy(button, true);
      state.userPage += button.dataset.userPage === 'next' ? 1 : -1;
      try {
        await refreshUsers();
        renderUsers();
      } catch (error) {
        console.error('Pagination utilisateurs échouée', error);
        toast(error.message || 'Chargement refusé', true);
        setButtonBusy(button, false);
      }
    });
  });
  bindUserActions();
}

function renderCmsSection(view) {
  const meta = getCmsViewMeta(view);
  const overview = state.cmsOverview;
  setView(`
    <section class="admin-view">
      <div class="admin-heading">
        <div>
          <p class="eyebrow">CMS Admin</p>
          <h1>${escapeHTML(meta.title)}</h1>
        </div>
        <button class="admin-secondary" type="button" data-refresh-cms ${state.cmsLoading ? 'disabled' : ''}>Actualiser</button>
      </div>
      <section class="admin-card">
        <div class="card-heading">
          <h2>${escapeHTML(meta.heading)}</h2>
          <span class="badge ${overview?.available ? 'active' : 'pending'}">${overview?.available ? 'Backend détecté' : 'Backend non installé'}</span>
        </div>
        <p>${escapeHTML(overview?.available ? meta.readyText : CMS_UNAVAILABLE_MESSAGE)}</p>
        <p>${escapeHTML(meta.fallbackText)}</p>
      </section>
      <div class="admin-grid metrics">
        ${metric('Séries (publiées / total)', `${overview?.examSeriesPublished || 0} / ${overview?.examSeriesCount || 0}`)}
        ${metric('Leçons (publiées / total)', `${overview?.lessonsPublished || 0} / ${overview?.lessonsCount || 0}`)}
        ${metric('Panneaux (publiés / total)', `${overview?.panelsPublished || 0} / ${overview?.panelsCount || 0}`)}
        ${metric('Médias CMS', overview?.mediaCount || 0)}
      </div>
      <section class="admin-card">
        <div class="card-heading">
          <h2>Phase A</h2>
        </div>
        <div class="latest-list">
          ${meta.items.map((item) => `<div class="latest-item"><div><strong>${escapeHTML(item.title)}</strong><span>${escapeHTML(item.text)}</span></div></div>`).join('')}
        </div>
      </section>
    </section>
  `);
  document.querySelector('[data-refresh-cms]').addEventListener('click', async (event) => {
    setButtonBusy(event.currentTarget, true);
    await refreshCmsOverview({ force: true });
    renderCmsSection(view);
  });
  if (!overview && !state.cmsLoading) {
    refreshCmsOverview().then(() => {
      if (state.currentView === view) renderCmsSection(view);
    });
  }
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
      await runAction(() => updateUserStatus(userId, status), 'Statut mis à jour', true, { button });
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
        return runAction(() => renameUser(button.dataset.rename, prenom), 'Prénom modifié');
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
        return runAction(() => resetUserPassword(button.dataset.resetPassword, value), 'Mot de passe réinitialisé');
      }
    }));
  });
}

function bindExamActions() {
  document.querySelector('[data-refresh]').addEventListener('click', async () => {
    await refreshExams();
    if (state.examBackendConfigured) toast('Données examens actualisées');
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
  document.querySelector('[data-open-selected-exam]').addEventListener('click', () => openExamInSpa(state.examKey));
  document.querySelectorAll('[data-open-exam-preview]').forEach((button) => {
    button.addEventListener('click', () => openExamInSpa(button.dataset.openExamPreview));
  });
  document.querySelectorAll('[data-exam-availability]').forEach((input) => {
    input.addEventListener('change', async () => {
      await updateExamAvailability(input.dataset.examAvailability, input.checked, input);
    });
  });
  document.querySelectorAll('[data-upload-question-image]').forEach((button) => {
    button.addEventListener('click', () => openImagePicker(button.dataset.uploadQuestionImage));
  });
  document.querySelectorAll('[data-restore-question-image]').forEach((button) => {
    button.addEventListener('click', () => confirmRestoreImage(button.dataset.restoreQuestionImage));
  });
  document.querySelectorAll('[data-view-question-in-exam]').forEach((button) => {
    button.addEventListener('click', () => openQuestionInExam(button.dataset.viewQuestionInExam));
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
          <button class="admin-button" type="button" data-upload-question-image="${escapeAttribute(question.id)}" ${state.examBackendConfigured ? '' : 'disabled'}>Remplacer l'image</button>
          ${override ? `<button class="admin-secondary" type="button" data-restore-question-image="${escapeAttribute(question.id)}">Restaurer l'image originale</button>` : ''}
          ${override ? `<button class="admin-secondary" type="button" data-view-question-in-exam="${escapeAttribute(question.id)}">Voir dans l'examen</button>` : ''}
        </div>
      </div>
    </article>
  `;
}

function openImagePicker(questionId) {
  if (!state.examBackendConfigured) return;
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
    const submit = event.currentTarget.querySelector('[type="submit"]');
    try {
      setButtonBusy(submit, true);
      await runAdminMutation(async () => {
        await uploadQuestionImage({
          examKey: state.examKey,
          questionId: question.id,
          seriesId: question.seriesId,
          file
        });
      });
      state.examOverrides[state.examKey] = await loadExamImageOverrides(state.examKey, { force: true });
      URL.revokeObjectURL(previewUrl);
      root.innerHTML = '';
      toast('Image mise à jour.');
      renderExams();
    } catch (error) {
      console.error('Upload image examen refusé', error);
      toast(error.message || 'Upload refusé', true);
    } finally {
      setButtonBusy(submit, false);
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
    const button = root.querySelector('[data-confirm-restore]');
    try {
      setButtonBusy(button, true);
      await runAdminMutation(() => restoreQuestionOriginalImage(state.examKey, question.id));
      state.examOverrides[state.examKey] = await loadExamImageOverrides(state.examKey, { force: true });
      root.innerHTML = '';
      toast('Image originale restaurée.');
      renderExams();
    } catch (error) {
      console.error('Restauration image examen refusée', error);
      toast(error.message || 'Restauration refusée', true);
    } finally {
      setButtonBusy(button, false);
    }
  });
}

async function updateExamAvailability(examKey, isOnline, control = null) {
  if (!state.examBackendConfigured) return;
  const status = isOnline ? 'online' : 'verification';
  const label = EXAM_LABELS[examKey] || 'Examen';
  const message = isOnline
    ? `${label} est maintenant disponible aux élèves.`
    : `${label} est repassé en vérification.`;
  await runAction(async () => {
    await updateExamStatus(examKey, status);
    state.examSettings = await loadExamSettings({ force: true });
  }, message, true, { refreshAfter: false, control });
}

function openExamInSpa(examKey) {
  sessionStorage.setItem(EXAM_NAV_ORIGIN_KEY, 'admin');
  sessionStorage.setItem(EXAM_ADMIN_RETURN_SECTION_KEY, 'exams');
  window.location.href = `index.html${window.getExamUrl(examKey)}`;
}

function openQuestionInExam(questionId) {
  const question = findQuestion(questionId);
  if (!question) return;
  sessionStorage.setItem(EXAM_NAV_ORIGIN_KEY, 'admin');
  sessionStorage.setItem(EXAM_ADMIN_RETURN_SECTION_KEY, 'exams');
  window.location.href = `index.html#/exam/${state.examKey}/series/${encodeURIComponent(question.seriesId)}?question=${encodeURIComponent(question.id)}`;
}

async function saveMaintenanceSettings() {
  const button = document.querySelector('[data-save-maintenance]');
  const enabled = document.querySelector('[data-maintenance-enabled]').checked;
  const wasEnabled = Boolean(state.runtimeSettings?.maintenance_enabled);
  const message = document.querySelector('[data-maintenance-message]').value;
  if (enabled !== wasEnabled) {
    openMaintenanceConfirm({
      enabled,
      message,
      onConfirm: () => applyMaintenanceSettings(enabled, message, button)
    });
    return;
  }
  await applyMaintenanceSettings(enabled, message, button);
}

async function applyMaintenanceSettings(enabled, message, button = null) {
  await runAction(async () => {
    state.runtimeSettings = await updateRuntimeMaintenance({ enabled, message });
  }, enabled ? 'Maintenance activée.' : 'Site remis en ligne.', true, { refreshAfter: false, button });
}

function openMaintenanceConfirm({ enabled, message, onConfirm }) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="admin-modal">
        <h2>${enabled ? 'Activer le mode maintenance ?' : 'Remettre le site en ligne ?'}</h2>
        <p>${enabled
          ? 'Les élèves actuellement connectés seront déconnectés et ne pourront pas se reconnecter tant que la maintenance restera active.'
          : 'Les utilisateurs pourront à nouveau se connecter et utiliser eAutoecole.'}</p>
        <div class="admin-actions">
          <button class="admin-secondary" type="button" data-close-modal>Annuler</button>
          <button class="admin-button" type="button" data-confirm-maintenance>${enabled ? 'Activer la maintenance' : 'Remettre en ligne'}</button>
        </div>
      </div>
    </div>
  `;
  root.querySelector('[data-close-modal]').addEventListener('click', () => {
    root.innerHTML = '';
    renderDashboard();
  });
  root.querySelector('[data-confirm-maintenance]').addEventListener('click', async () => {
    root.innerHTML = '';
    await onConfirm(message);
  });
}

async function runAction(fn, successMessage, rerender = true, { refreshAfter = true, button = null, control = null } = {}) {
  if (button?.disabled) return false;
  const busyTarget = button || control;
  try {
    setButtonBusy(busyTarget, true);
    await runAdminMutation(fn);
    if (refreshAfter) await refreshCurrentViewData();
    toast(successMessage);
    if (rerender) render();
    return true;
  } catch (error) {
    console.error('Action admin refusée', error);
    toast(error.message || 'Action refusée', true);
    return false;
  } finally {
    setButtonBusy(busyTarget, false);
  }
}

async function runAdminMutation(fn) {
  await ensureAdminSession();
  try {
    return await fn();
  } catch (error) {
    if (!isRecoverableSessionError(error) || typeof window.sbRefreshSession !== 'function') {
      throw error;
    }
    await window.sbRefreshSession();
    await ensureAdminSession();
    return fn();
  }
}

async function ensureAdminSession() {
  const session = typeof window.sbGetSession === 'function' ? await window.sbGetSession() : null;
  if (!session?.user) {
    window.location.href = 'auth.html?reason=session-expired';
    throw new Error('Session expirée. Reconnectez-vous.');
  }
  if (typeof window.sbIsAdmin === 'function' && !window.sbIsAdmin(session.user)) {
    throw new Error('Accès administrateur refusé.');
  }
  return session;
}

function isRecoverableSessionError(error) {
  const text = `${error?.message || ''} ${error?.code || ''} ${error?.status || ''}`.toLowerCase();
  return text.includes('jwt') || text.includes('token') || text.includes('session') || text.includes('expired') || text.includes('401') || text.includes('non connecté');
}

function setButtonBusy(target, busy) {
  if (!target) return;
  if (busy) {
    target.dataset.busyLabel = target.textContent || '';
    target.disabled = true;
    target.setAttribute('aria-busy', 'true');
    if (target.tagName === 'BUTTON') target.textContent = 'Traitement...';
    return;
  }
  target.disabled = false;
  target.removeAttribute('aria-busy');
  if (target.tagName === 'BUTTON' && target.dataset.busyLabel) {
    target.textContent = target.dataset.busyLabel;
  }
  delete target.dataset.busyLabel;
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
    const submit = event.currentTarget.querySelector('[type="submit"]');
    setButtonBusy(submit, true);
    try {
      const result = await onSubmit(new FormData(event.currentTarget).get('value'));
      if (result !== false) root.innerHTML = '';
    } finally {
      setButtonBusy(submit, false);
    }
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
  return state.userCounts || countProfilesFromPage();
}

function countProfilesFromPage() {
  return {
    total: state.profiles.length,
    pending: state.profiles.filter((p) => p.status === 'pending').length,
    active: state.profiles.filter((p) => p.status === 'active').length,
    blocked: state.profiles.filter((p) => p.status === 'blocked').length
  };
}

function getSelectedExam() {
  return EXAMS[state.examKey] || EXAMS.light;
}

function getExamSetting(examKey) {
  return state.examSettings.find((setting) => setting.exam_key === examKey) || { exam_key: examKey, status: 'verification' };
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

function isCmsView(view) {
  return view === 'lessons' || view === 'panels' || view === 'media';
}

function getCmsViewMeta(view) {
  const metas = {
    lessons: {
      title: 'Leçons',
      heading: 'Gestion des leçons',
      readyText: 'Le backend CMS est détecté. L’édition complète des leçons sera activée en Phase B.',
      fallbackText: 'Fallback actuel : assets/js/data/lessons-data.js reste la source utilisée par les élèves.',
      items: [
        { title: 'Brouillons', text: 'Prévu : édition en brouillon avant publication.' },
        { title: 'Étapes', text: 'Prévu : titre, contenu, ordre, questions et corrections.' },
        { title: 'Publication', text: 'Prévu : contenu publié visible aux élèves, legacy conservé en secours.' }
      ]
    },
    panels: {
      title: 'Panneaux',
      heading: 'Gestion des panneaux',
      readyText: 'Le backend CMS est détecté. L’édition complète des panneaux sera activée en Phase B.',
      fallbackText: 'Fallback actuel : assets/js/data/panels-data.js et les images Images/ restent utilisés.',
      items: [
        { title: 'Fiches panneaux', text: 'Prévu : catégorie, titre, description, image et ordre.' },
        { title: 'Audio Français', text: 'Prévu : fichier admin si présent, fallback TTS navigateur ensuite.' },
        { title: 'Audio Wolof', text: 'Prévu : fichier audio admin uniquement, sans TTS automatique supposé.' }
      ]
    },
    media: {
      title: 'Médias',
      heading: 'Bibliothèque médias',
      readyText: 'Le backend CMS est détecté. La gestion des médias sera activée en Phase B.',
      fallbackText: 'Stockage prévu : content-audio/panels/<panel-id>/fr/ et content-audio/panels/<panel-id>/wo/.',
      items: [
        { title: 'Images', text: 'Prévu : référencement des images de contenu sans supprimer les fichiers Git.' },
        { title: 'Audios', text: 'Formats prévus : MP3, MP4 audio, WebM audio, Ogg.' },
        { title: 'Sécurité', text: 'Écriture admin uniquement via public.is_admin().' }
      ]
    }
  };
  return metas[view] || metas.lessons;
}

function setView(html) {
  document.getElementById('admin-view').innerHTML = html;
}

function resolveInitialView() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view') || sessionStorage.getItem(EXAM_ADMIN_RETURN_SECTION_KEY);
  sessionStorage.removeItem(EXAM_NAV_ORIGIN_KEY);
  sessionStorage.removeItem(EXAM_ADMIN_RETURN_SECTION_KEY);
  if (view === 'users' || view === 'exams' || view === 'dashboard' || isCmsView(view)) {
    if (params.has('view')) {
      const cleanUrl = `${window.location.pathname}${window.location.hash || ''}`;
      window.history.replaceState(null, '', cleanUrl);
    }
    return view;
  }
  return 'dashboard';
}

function metric(label, value) {
  return `<section class="admin-card metric"><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong></section>`;
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
