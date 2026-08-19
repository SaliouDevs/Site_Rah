import { registerRoute, setFallbackRoute, startRouter, navigateTo, getCurrentPath } from './router.js';
import { LESSONS_DATA } from './data/lessons-data.js';
import { renderLessonsView, renderLessonView } from './modules/lessons.js';
import { renderPanelsView } from './modules/panels.js';
import { renderTestsView } from './modules/tests.js';
import { renderVideosView } from './modules/videos.js';
import { renderExamHome, renderExamSeries, renderExamsView } from './modules/exam-engine.js';
import { renderExamReviewDashboard, renderExamReviewQuestion } from './modules/exam-review.js';
import {
  getLearningProgress,
  getLessonState,
  getResumeTarget,
  getStateLabel
} from './progress.js';
import { requireAuthenticatedUser, logoutCurrentUser } from './services/auth-service.js';

const appConfig = window.APP_CONFIG;
const examsConfig = window.EXAMS_CONFIG;
const contactConfig = window.CONTACT_CONFIG;

let currentUser = null;
let appView;
let bottomNav;
let currentSettings = null;

document.addEventListener('DOMContentLoaded', initializeApp);

async function initializeApp() {
  appView = document.getElementById('app-view');
  bottomNav = document.getElementById('bottom-nav');
  appView.innerHTML = '<section class="loading-screen"><span class="spinner"></span><p>Chargement...</p></section>';
  applySavedTheme();
  installUiGlobals();

  const authContext = await requireAuthenticatedUser({ onMaintenance: renderMaintenanceView });
  if (!authContext) {
    return;
  }

  currentSettings = authContext.settings || {};
  currentUser = normalizeProfile(authContext.profile);
  window.EAUTO_CURRENT_USER = currentUser;
  renderHeader();
  renderBottomNav();
  registerRoutes();
  startRouter();
  updateBottomNav();
  installProfileGuard(authContext.user?.id);
  window.addEventListener('hashchange', updateBottomNav);
  window.addEventListener('learning-progress-updated', () => {
    if (getCurrentPath() === '/home' || getCurrentPath() === '/progress') {
      renderCurrentRoute();
    }
  });
}

function registerRoutes() {
  registerRoute('/home', renderHomeView);
  registerRoute('/lessons', (params) => renderLessonsView(appView, params));
  registerRoute('/lesson/:id', (params) => renderLessonView(appView, params));
  registerRoute('/panels', (params) => renderPanelsView(appView, params));
  registerRoute('/panels/:category', (params) => renderPanelsView(appView, params));
  registerRoute('/tests', () => renderTestsView(appView));
  registerRoute('/exams', () => renderExamsView(appView, currentUser));
  registerRoute('/exam/:type', (params) => renderExamHome(appView, params, currentUser));
  registerRoute('/exam/:type/series/:seriesId', (params) => renderExamSeries(appView, params, currentUser));
  registerRoute('/exam-review/:type', (params) => renderExamReviewDashboard(appView, params, currentUser));
  registerRoute('/exam-review/:type/:questionId', (params) => renderExamReviewQuestion(appView, params, currentUser));
  registerRoute('/videos', (params) => renderVideosView(appView, params));
  registerRoute('/videos/:videoId', (params) => renderVideosView(appView, params));
  registerRoute('/progress', renderProgressView);
  registerRoute('/profile', renderProfileView);
  registerRoute('/contact', renderContactView);
  registerRoute('/about', renderAboutView);
  setFallbackRoute(() => navigateTo('/home'));
}

function renderCurrentRoute() {
  const event = new HashChangeEvent('hashchange');
  window.dispatchEvent(event);
}

function renderHeader() {
  const header = document.getElementById('app-header');
  const initial = escapeHTML((currentUser.prenom || 'É').trim().charAt(0).toUpperCase());
  header.innerHTML = `
    <div class="app-header-inner">
      <button class="brand-lockup" type="button" data-route="/home" aria-label="Accueil">
        <span class="brand-mark"><i class="fas fa-car-side"></i></span>
        <span>
          <strong>${escapeHTML(appConfig.name)}</strong>
          <small>${escapeHTML(currentSettings?.school_name || appConfig.schoolName)}</small>
        </span>
      </button>
      <div class="app-header-actions">
        <a href="https://wa.me/${escapeAttribute(contactConfig.whatsapp)}" target="_blank" rel="noopener" class="icon-button" aria-label="Aide WhatsApp">
          <i class="fab fa-whatsapp"></i>
        </a>
        <button class="profile-trigger" type="button" data-route="/profile" aria-label="Ouvrir le profil">
          ${currentUser.photo ? `<img src="${escapeAttribute(currentUser.photo)}" alt="Photo de profil" class="profile-photo">` : `<span class="user-avatar">${initial}</span>`}
        </button>
      </div>
    </div>
  `;
  bindRouteLinks(header);
}

function renderBottomNav() {
  bottomNav.innerHTML = `
    <button class="nav-item" type="button" data-route="/home"><i class="fas fa-home"></i><span>Accueil</span></button>
    <button class="nav-item" type="button" data-route="/lessons"><i class="fas fa-book-open"></i><span>Leçons</span></button>
    <button class="nav-item" type="button" data-route="/tests"><i class="fas fa-clipboard-check"></i><span>Tests</span></button>
    <button class="nav-item" type="button" data-route="/progress"><i class="fas fa-chart-line"></i><span>Progrès</span></button>
    <button class="nav-item" type="button" data-route="/profile"><i class="fas fa-user"></i><span>Profil</span></button>
  `;
  bindRouteLinks(bottomNav);
}

function renderHomeView() {
  const progress = getLearningProgress();
  const resume = getResumeTarget();
  const masteredCount = progress.masteredLessons.length;
  const percent = Math.round((masteredCount / LESSONS_DATA.length) * 100);
  appView.innerHTML = `
    <section class="home-view view-stack">
      <div class="dashboard-hero">
        <div>
          <p class="eyebrow">Formation Code de la route</p>
          <h1>Bonjour, ${escapeHTML(currentUser.prenom || 'Élève')}</h1>
          <p>Ta progression : ${masteredCount} / ${LESSONS_DATA.length} leçons maîtrisées.</p>
        </div>
        <div class="lesson-progress-card">
          <div class="progress-meta"><span>Maîtrise globale</span><strong>${percent} %</strong></div>
          <div class="progress-track"><span style="width:${percent}%"></span></div>
        </div>
      </div>

      <section class="continue-card">
        <div>
          <p class="eyebrow">Continuer</p>
          <h2>Leçon ${resume.lesson.id} · ${resume.lesson.title}</h2>
          <p>Étape ${resume.step + 1}</p>
        </div>
        <button class="primary-action" type="button" data-route="/lesson/${resume.lesson.id}">Reprendre</button>
      </section>

      <section class="dashboard-section">
        <div class="section-heading"><h2>Apprendre</h2></div>
        <div class="action-grid">
          <button class="nav-card action-card" type="button" data-route="/lessons"><i class="fas fa-book-open"></i><span>Leçons</span><small>Parcours guidé</small></button>
          <button class="nav-card action-card" type="button" data-route="/panels"><i class="fas fa-traffic-light"></i><span>Panneaux</span><small>Apprendre et réviser</small></button>
        </div>
      </section>
      ${renderAnnouncement()}

      <section class="dashboard-section">
        <div class="section-heading"><h2>S'entraîner</h2></div>
        <div class="action-grid single">
          <button class="nav-card action-card" type="button" data-route="/tests"><i class="fas fa-clipboard-check"></i><span>Tests</span><small>Séries d'examen</small></button>
        </div>
      </section>

      <section class="dashboard-section">
        <div class="section-heading"><h2>Ressources</h2></div>
        <div class="action-grid single">
          <button class="nav-card action-card" type="button" data-route="/videos"><i class="fas fa-circle-play"></i><span>Vidéos</span><small>Tutoriels</small></button>
        </div>
      </section>

      <section class="dashboard-section">
        <div class="section-heading"><h2>Préparation examens</h2></div>
        <div class="exam-grid">
          ${renderExamCard('light', 'Permis B', 'Poids léger', examsConfig.light?.enabled || examsConfig.poidsLegerEnabled)}
          ${renderExamCard('heavy', 'Permis C', 'Poids lourd', examsConfig.heavy?.enabled || examsConfig.poidsLourdEnabled)}
        </div>
      </section>
    </section>
  `;
  bindRouteLinks(appView);
  bindExamCards(appView);
}

function renderProgressView() {
  const progress = getLearningProgress();
  const masteredCount = progress.masteredLessons.length;
  const percent = Math.round((masteredCount / LESSONS_DATA.length) * 100);
  const resume = getResumeTarget();
  const mistakes = Object.values(progress.mistakes).flat();
  appView.innerHTML = `
    <section class="view-stack">
      <div class="view-heading">
        <p class="eyebrow">Suivi réel</p>
        <h1>Progrès</h1>
      </div>
      <div class="progress-summary">
        <div class="metric-card"><span>Leçons maîtrisées</span><strong>${masteredCount} / ${LESSONS_DATA.length}</strong></div>
        <div class="metric-card"><span>Maîtrise globale</span><strong>${percent} %</strong></div>
        <div class="metric-card wide"><span>Dernière leçon</span><strong>${resume.lesson.title}</strong></div>
      </div>
      <section class="score-list">
        <h2>Scores</h2>
        ${LESSONS_DATA.map((lesson) => {
          const score = progress.lessonScores[lesson.id];
          const state = getLessonState(lesson.id);
          return `<div><span>${lesson.title}</span><strong>${score ? `${score} %` : getStateLabel(state)}</strong></div>`;
        }).join('')}
      </section>
      <section class="review-list progress-review">
        <strong>À revoir</strong>
        <span>${mistakes.length ? `${new Set(mistakes).size} notions à revoir` : 'Aucune erreur enregistrée pour le moment'}</span>
      </section>
    </section>
  `;
}

function renderProfileView() {
  const initial = escapeHTML((currentUser.prenom || 'É').trim().charAt(0).toUpperCase());
  appView.innerHTML = `
    <section class="profile-layout">
      <div class="profile-card-main">
        <div class="profile-identity">
          <button class="profile-photo-button" type="button" data-upload-photo aria-label="Changer la photo de profil">
            ${currentUser.photo ? `<img src="${escapeAttribute(currentUser.photo)}" alt="Photo de profil" class="profile-photo large">` : `<span class="user-avatar large">${initial}</span>`}
            <i class="fas fa-camera"></i>
          </button>
          <div>
            <p class="eyebrow">Mon compte</p>
            <h1>${escapeHTML(currentUser.prenom || 'Élève')}</h1>
            <button class="text-button" type="button" data-edit-name><i class="fas fa-pen"></i> Modifier le prénom</button>
          </div>
        </div>
        <dl class="profile-details">
          <div><dt>Formule</dt><dd>${escapeHTML(currentUser.formule || 'Formule Illimitée')}</dd></div>
          <div><dt>Statut</dt><dd>${escapeHTML(currentUser.status || 'Actif')}</dd></div>
          <div><dt>Téléphone</dt><dd>${escapeHTML(currentUser.telephone || '')}</dd></div>
          <div><dt>Date d'inscription</dt><dd>${formatDate(currentUser.dateInscription)}</dd></div>
        </dl>
        <input type="file" id="photoUpload" class="profile-photo-input" accept="image/*">
      </div>
      <div class="profile-group">
        <h2>Préférences</h2>
        <button class="profile-row" type="button" data-toggle-theme><i class="fas fa-moon"></i><span>Apparence</span><strong>Clair / sombre</strong></button>
      </div>
      <div class="profile-group">
        <h2>Support</h2>
        <button class="profile-row" type="button" data-route="/contact"><i class="fas fa-phone"></i><span>Contacter l'auto-école</span><strong>Coordonnées</strong></button>
        <a class="profile-row" href="https://wa.me/${escapeAttribute(contactConfig.whatsapp)}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i><span>WhatsApp</span><strong>${escapeHTML(contactConfig.phone)}</strong></a>
      </div>
      <div class="profile-group">
        <h2>Application</h2>
        <button class="profile-row" type="button" data-route="/about"><i class="fas fa-circle-info"></i><span>À propos</span><strong>eAutoecole</strong></button>
        <button class="profile-row danger" type="button" data-logout><i class="fas fa-sign-out-alt"></i><span>Se déconnecter</span></button>
      </div>
    </section>
  `;
  bindRouteLinks(appView);
  bindProfileActions();
}

function renderContactView() {
  appView.innerHTML = `
    <section class="view-stack">
      <button class="text-back" type="button" data-route="/profile">← Profil</button>
      <div class="view-heading">
        <p class="eyebrow">Contact</p>
        <h1>${escapeHTML(currentSettings?.school_name || 'Auto-école')}</h1>
      </div>
      <div class="contact-panel">
        <h2>Notre numéro</h2>
        <p>${escapeHTML(contactConfig.phone)}</p>
        <div class="reader-actions">
          <a class="primary-action" href="tel:${escapeAttribute(contactConfig.phoneHref)}">Appeler</a>
          <a class="secondary-action" href="https://wa.me/${escapeAttribute(contactConfig.whatsapp)}" target="_blank" rel="noopener">WhatsApp</a>
        </div>
      </div>
      <div class="contact-grid compact">
        <div class="contact-card"><i class="fas fa-envelope"></i><h2>Email</h2><p><a href="mailto:${escapeAttribute(contactConfig.email)}">${escapeHTML(contactConfig.email)}</a></p></div>
        <div class="contact-card"><i class="fas fa-location-dot"></i><h2>Adresse</h2><p>${escapeHTML(contactConfig.address)}</p></div>
      </div>
    </section>
  `;
  bindRouteLinks(appView);
}

function renderAboutView() {
  appView.innerHTML = `
    <section class="view-stack">
      <button class="text-back" type="button" data-route="/profile">← Profil</button>
      <div class="view-heading">
        <p class="eyebrow">Application</p>
        <h1>eAutoecole</h1>
        <p>Plateforme d'apprentissage du Code de la route de l'Auto-école.</p>
      </div>
    </section>
  `;
  bindRouteLinks(appView);
}

function renderExamCard(examId, license, title, enabled) {
  const canPreview = typeof window.canPreviewExam === 'function' && window.canPreviewExam(examId, currentUser);
  return `
    <button class="nav-card exam-card ${enabled ? '' : 'exam-unavailable'}" type="button" data-exam-card data-exam-id="${escapeAttribute(examId)}" aria-disabled="${enabled || canPreview ? 'false' : 'true'}">
      <span class="exam-license">${license}</span>
      <strong>${title}</strong>
      <span class="exam-status-badge"><i class="fas fa-screwdriver-wrench"></i> En correction</span>
      ${canPreview ? '<span class="exam-preview-label">Prévisualiser</span>' : ''}
    </button>
  `;
}

function bindExamCards(root) {
  root.querySelectorAll('[data-exam-card]').forEach((button) => {
    button.addEventListener('click', () => {
      const examId = button.dataset.examId;
      if (typeof window.canPreviewExam === 'function' && window.canPreviewExam(examId, currentUser)) {
        navigateTo(`/exam/${window.normalizeExamId?.(examId) || examId}`);
        return;
      }
      window.eautoModal(`
        <div class="modal-card">
          <button class="modal-close" type="button" data-close-modal aria-label="Fermer">×</button>
          <div class="exam-unavailable-icon"><i class="fas fa-screwdriver-wrench"></i></div>
          <h2>Examen en cours de correction</h2>
          <p>Nous vérifions actuellement certaines questions avant de remettre cet examen en ligne.</p>
        </div>
      `);
    });
  });
}

function bindRouteLinks(root) {
  root.querySelectorAll('[data-route]').forEach((button) => {
    button.addEventListener('click', () => navigateTo(button.dataset.route));
  });
}

function bindProfileActions() {
  appView.querySelector('[data-toggle-theme]').addEventListener('click', toggleTheme);
  appView.querySelector('[data-logout]').addEventListener('click', deconnexion);
  appView.querySelector('[data-upload-photo]').addEventListener('click', () => appView.querySelector('#photoUpload').click());
  appView.querySelector('#photoUpload').addEventListener('change', handlePhotoUpload);
  appView.querySelector('[data-edit-name]').addEventListener('click', editName);
}

function editName() {
  window.eautoModal(`
    <form class="modal-card" data-name-form>
      <button class="modal-close" type="button" data-close-modal aria-label="Fermer">×</button>
      <h2>Modifier le prénom</h2>
      <label for="modalName">Prénom</label>
      <input id="modalName" name="prenom" value="${currentUser.prenom || ''}" required>
      <button class="primary-action" type="submit">Enregistrer</button>
    </form>
  `);
  document.querySelector('[data-name-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const prenom = event.target.prenom.value.trim();
    if (!prenom) {
      return;
    }
    currentUser.prenom = prenom;
    if (currentUser.isSupabaseUser && typeof window.sbUpdateProfile === 'function') {
      await window.sbUpdateProfile({ prenom });
    }
    closeModal();
    renderHeader();
    renderProfileView();
    window.eautoToast('Prénom mis à jour');
  });
}

async function handlePhotoUpload(event) {
  const file = event.target.files[0];
  if (!file) {
    return;
  }
  const reader = new FileReader();
  reader.onload = async () => {
    currentUser.photo = reader.result;
    if (currentUser.isSupabaseUser && typeof window.sbUploadPhoto === 'function') {
      try {
        currentUser.photo = await window.sbUploadPhoto(file);
      } catch (error) {
        window.eautoToast(`Erreur upload photo : ${error.message}`);
        return;
      }
    }
    renderHeader();
    renderProfileView();
    window.eautoToast('Photo mise à jour');
  };
  reader.readAsDataURL(file);
}

function applySavedTheme() {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.body.classList.add('dark-mode');
  }
}

function toggleTheme() {
  const isDark = !document.body.classList.contains('dark-mode');
  document.body.classList.toggle('dark-mode', isDark);
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

async function deconnexion() {
  await logoutCurrentUser(currentUser);
}

function updateBottomNav() {
  const path = getCurrentPath();
  const immersive = /^\/lesson\/|^\/panels\/|^\/videos\/.+|^\/exam\/[^/]+\/series\//.test(path);
  bottomNav.style.display = immersive ? 'none' : 'flex';
  bottomNav.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
  const activeRoute = path.startsWith('/lesson') ? '/lessons'
    : path.startsWith('/tests') ? '/tests'
    : path.startsWith('/exam') || path.startsWith('/exams') ? '/home'
    : path.startsWith('/progress') ? '/progress'
    : path.startsWith('/profile') || path.startsWith('/contact') || path.startsWith('/about') ? '/profile'
    : path.startsWith('/panels') || path.startsWith('/videos') ? ''
    : '/home';
  const active = activeRoute ? bottomNav.querySelector(`[data-route="${activeRoute}"]`) : null;
  if (active) {
    active.classList.add('active');
  }
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function normalizeProfile(profile) {
  return {
    prenom: profile.prenom || 'Élève',
    telephone: profile.telephone || '',
    dateInscription: profile.created_at || new Date().toISOString(),
    status: profile.status || 'active',
    formule: profile.formule || 'Formule Illimitée',
    prix: profile.prix || 2000,
    photo: profile.photo_url || profile.photo || null,
    isAdmin: !!profile.isAdmin,
    isSupabaseUser: profile.isSupabaseUser,
    isDevUser: profile.isDevUser
  };
}

function installProfileGuard(userId) {
  if (userId) {
    if (window.sbSubscribe) {
      window.sbSubscribe(
        `profile-guard-${userId}`,
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
        async ({ new: profile }) => {
          if (profile.status === 'blocked' || profile.status === 'pending') {
            await window.sbLogout();
            window.location.href = `auth.html?status=${profile.status}`;
          }
        }
      );
    }
  }
}

function renderAnnouncement() {
  if (!currentSettings?.announcement_message) return '';
  if (currentSettings.announcement_expires_at && new Date(currentSettings.announcement_expires_at) < new Date()) return '';
  return `
    <section class="announcement-card">
      <strong>${escapeHTML(currentSettings.announcement_title || 'Annonce')}</strong>
      <span>${escapeHTML(currentSettings.announcement_message)}</span>
    </section>
  `;
}

function renderMaintenanceView(settings) {
  if (bottomNav) bottomNav.style.display = 'none';
  document.getElementById('app-header').innerHTML = '';
  appView.innerHTML = `
    <section class="maintenance-screen">
      <div class="brand-mark"><i class="fas fa-car-side"></i></div>
      <p class="eyebrow">eAutoecole</p>
      <h1>${escapeHTML(settings.maintenance_title || 'Maintenance en cours')}</h1>
      <p>${escapeHTML(settings.maintenance_message || 'Nous effectuons actuellement des améliorations.')}</p>
      <a class="primary-action" href="https://wa.me/${escapeAttribute(contactConfig.whatsapp)}">Contacter l’auto-école</a>
    </section>
  `;
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

function installUiGlobals() {
  window.eautoToast = function eautoToast(message) {
    const root = document.getElementById('toast-root');
    root.innerHTML = `<div class="toast" role="status">${escapeHTML(message)}</div>`;
    window.clearTimeout(root.toastTimer);
    root.toastTimer = window.setTimeout(() => root.innerHTML = '', 2200);
  };
  window.eautoModal = function eautoModal(html) {
    const root = document.getElementById('modal-root');
    root.innerHTML = `<div class="modal-backdrop" role="dialog" aria-modal="true">${html}</div>`;
    root.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', closeModal));
    root.querySelector('.modal-backdrop').addEventListener('click', (event) => {
      if (event.target.classList.contains('modal-backdrop')) {
        closeModal();
      }
    });
  };
  window.eautoConfirm = function eautoConfirm({ title, message, confirmLabel, cancelLabel, onConfirm }) {
    window.eautoModal(`
      <div class="modal-card">
        <h2>${title}</h2>
        <p>${message}</p>
        <div class="reader-actions">
          <button class="secondary-action" type="button" data-close-modal>${cancelLabel}</button>
          <button class="primary-action" type="button" data-confirm-action>${confirmLabel}</button>
        </div>
      </div>
    `);
    document.querySelector('[data-confirm-action]').addEventListener('click', () => {
      closeModal();
      onConfirm();
    });
  };
}

function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
}

function formatDate(value) {
  if (!value) {
    return '';
  }
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(value));
}
