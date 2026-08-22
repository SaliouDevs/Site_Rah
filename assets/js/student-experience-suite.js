import { navigateTo } from './router.js';
import { getLearningDashboard } from './services/learning-service.js';
import { loadStudentCoachingQuestions, loadStudentInstructorSummary, submitStudentCoachingQuestion } from './services/instructor-service.js';

let dashboardCache = null;
let summaryCache = undefined;
let questionsCache = null;
let pending = false;

document.addEventListener('DOMContentLoaded', () => {
  observe();
  window.setTimeout(enhance, 80);
});
window.addEventListener('hashchange', () => window.setTimeout(enhance, 60));
window.addEventListener('learning-points-updated', () => { dashboardCache = null; enhance(); });

function observe() {
  const root = document.getElementById('app-view');
  if (!root) return;
  const observer = new MutationObserver(() => {
    clearTimeout(observer.timer);
    observer.timer = setTimeout(enhance, 50);
  });
  observer.observe(root, { childList: true, subtree: true });
}

async function enhance() {
  const user = window.EAUTO_CURRENT_USER;
  if (!user || user.isAdmin || user.isInstructor) return;
  const path = location.hash.replace(/^#/, '').split('?')[0] || '/home';
  if (path === '/home') await enhanceHome();
  if (path === '/progress') await enhanceProgress();
  if (path === '/monitor') await enhanceMonitor();
}

async function getDashboard(force = false) {
  if (!force && dashboardCache) return dashboardCache;
  dashboardCache = await getLearningDashboard().catch(() => ({ points: 0, answered: 0, correct: 0, readiness: 0, streakDays: 0, activityToday: 0, level: 'Débutant', weakTopics: [] }));
  return dashboardCache;
}

async function getSummary(force = false) {
  if (!force && summaryCache !== undefined) return summaryCache;
  summaryCache = await loadStudentInstructorSummary().catch(() => null);
  return summaryCache;
}

async function enhanceHome() {
  const root = document.querySelector('.home-view');
  if (!root) return;
  const [dashboard, summary] = await Promise.all([getDashboard(), getSummary()]);
  personalizeHero(root);
  if (!root.querySelector('[data-readiness-strip]')) {
    const hero = root.querySelector('.dashboard-hero');
    const section = document.createElement('section');
    section.className = 'student-readiness';
    section.dataset.readinessStrip = 'true';
    section.innerHTML = `
      <div class="readiness-main">
        <div class="readiness-ring" style="--value:${clamp(dashboard.readiness)}"><strong>${clamp(dashboard.readiness)}%</strong></div>
        <div class="readiness-copy"><small>Préparation estimée</small><strong>${escapeHTML(dashboard.level || 'Débutant')}</strong><span>${readinessMessage(Number(dashboard.readiness || 0))}</span></div>
      </div>
      <div class="readiness-metric"><small>Série active</small><strong>${Number(dashboard.streakDays || 0)} j</strong></div>
      <div class="readiness-metric"><small>Aujourd’hui</small><strong>${Number(dashboard.activityToday || 0)}</strong></div>
      <div class="readiness-metric"><small>Points</small><strong>${Number(dashboard.points || 0)}</strong></div>`;
    hero?.insertAdjacentElement('afterend', section);
  }

  const hub = root.querySelector('[data-learning-hub]');
  if (hub) {
    hub.classList.add('training-studio');
    const eyebrow = hub.querySelector('.learning-hub-head .eyebrow');
    const heading = hub.querySelector('.learning-hub-head h2');
    if (eyebrow) eyebrow.textContent = 'Choisis ton rythme';
    if (heading) heading.textContent = 'Ton studio d’entraînement';
  }

  if (summary && !root.querySelector('[data-student-coach-card]')) {
    const instructor = summary.instructor || {};
    const goals = Array.isArray(summary.goals) ? summary.goals.filter((goal) => goal.status === 'active') : [];
    const sessions = Array.isArray(summary.sessions) ? summary.sessions.filter((session) => session.status === 'planned' && new Date(session.scheduledAt) >= new Date()).sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt)) : [];
    const card = document.createElement('section');
    card.className = 'student-coach-card';
    card.dataset.studentCoachCard = 'true';
    card.innerHTML = `<div class="student-coach-copy"><span class="student-coach-avatar">${initials(instructor.prenom)}</span><div><small>Ton accompagnement</small><strong>${escapeHTML(instructor.prenom || 'Moniteur')}</strong><p>${sessions[0] ? `Prochaine conduite : ${formatDateTime(sessions[0].scheduledAt)}` : goals[0] ? `Objectif : ${escapeHTML(goals[0].title)}` : 'Ton moniteur peut suivre tes progrès et te fixer des objectifs.'}</p><div class="student-coach-meta"><span class="coach-chip">${goals.length} objectif${goals.length > 1 ? 's' : ''}</span><span class="coach-chip">${sessions.length} séance${sessions.length > 1 ? 's' : ''} prévue${sessions.length > 1 ? 's' : ''}</span></div></div></div><button class="primary-action compact-action" type="button" data-open-monitor>Voir le suivi</button>`;
    const studio = root.querySelector('[data-learning-hub]');
    studio?.insertAdjacentElement('afterend', card);
    card.querySelector('[data-open-monitor]')?.addEventListener('click', () => navigateTo('/monitor'));
  }
}

function personalizeHero(root) {
  const school = window.EAUTO_SCHOOL_SETTINGS;
  if (!school) return;
  const hero = root.querySelector('.dashboard-hero');
  if (!hero || hero.dataset.personalized === '1') return;
  hero.dataset.personalized = '1';
  const eyebrow = hero.querySelector('.eyebrow');
  const title = hero.querySelector('h1');
  const copy = hero.querySelector('p:not(.eyebrow)');
  if (eyebrow) eyebrow.textContent = school.tagline || 'Formation Code de la route';
  if (title) title.textContent = `Bonjour, ${window.EAUTO_CURRENT_USER?.prenom || 'Élève'}`;
  if (copy) copy.textContent = school.hero_message || copy.textContent;
}

async function enhanceProgress() {
  const card = document.querySelector('[data-smart-progress]');
  if (!card || card.classList.contains('experience-ready')) return;
  const dashboard = await getDashboard();
  card.classList.add('experience-ready');
  const metrics = document.createElement('div');
  metrics.className = 'experience-progress-metrics';
  metrics.innerHTML = `<div><small>Préparation</small><strong>${clamp(dashboard.readiness)}%</strong></div><div><small>Série active</small><strong>${Number(dashboard.streakDays || 0)} jours</strong></div><div><small>Niveau</small><strong>${escapeHTML(dashboard.level || 'Débutant')}</strong></div>`;
  card.appendChild(metrics);
}

async function enhanceMonitor() {
  const view = document.querySelector('.monitor-space');
  if (!view || view.dataset.serverEnhanced === '1') return;
  view.dataset.serverEnhanced = '1';
  const notice = view.querySelector('.cms-inline-notice');
  if (notice) notice.remove();
  const [summary, questions] = await Promise.all([getSummary(true), loadStudentCoachingQuestions().catch(() => [])]);
  questionsCache = questions;
  const panel = document.createElement('section');
  panel.className = 'monitor-server-panel';
  panel.dataset.monitorServer = 'true';
  if (!summary) {
    panel.innerHTML = `<div class="monitor-live-card"><h3>Aucun moniteur référent pour le moment</h3><p>Ton auto-école peut t’affecter un moniteur. En attendant, continue les leçons et les entraînements : tes résultats resteront disponibles lorsqu’un suivi sera activé.</p><button class="secondary-action" data-go-home>Continuer mon parcours</button></div>`;
    view.appendChild(panel);
    panel.querySelector('[data-go-home]')?.addEventListener('click', () => navigateTo('/home'));
    return;
  }

  const instructor = summary.instructor || {};
  const goals = Array.isArray(summary.goals) ? summary.goals : [];
  const sessions = Array.isArray(summary.sessions) ? summary.sessions : [];
  const notes = Array.isArray(summary.notes) ? summary.notes : [];
  panel.innerHTML = `
    <div class="monitor-person-card"><div class="monitor-person"><span class="student-coach-avatar">${initials(instructor.prenom)}</span><div><p class="eyebrow" style="color:#b9e8cf">Moniteur référent</p><h2>${escapeHTML(instructor.prenom || 'Moniteur')}</h2><p>${instructor.telephone ? escapeHTML(formatPhone(instructor.telephone)) : 'Suivi pédagogique actif'}</p></div></div><div class="monitor-person-actions">${instructor.telephone ? `<a href="tel:${escapeAttr(normalizePhoneHref(instructor.telephone))}"><i class="fas fa-phone"></i> Appeler</a><a href="https://wa.me/221${escapeAttr(String(instructor.telephone).replace(/\D/g, '').replace(/^221/,''))}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i> WhatsApp</a>` : ''}</div></div>
    <div class="monitor-live-grid">
      <article class="monitor-live-card"><h3>Mes objectifs</h3><div class="monitor-live-list">${goals.length ? goals.slice(0, 6).map((goal) => `<div class="monitor-live-row"><strong>${escapeHTML(goal.title)}</strong><small>${goal.status === 'done' ? 'Terminé ✓' : goal.dueDate ? `À faire avant le ${formatDate(goal.dueDate)}` : 'Objectif actif'}</small>${goal.details ? `<span>${escapeHTML(goal.details)}</span>` : ''}</div>`).join('') : '<div class="monitor-live-row"><span>Aucun objectif fixé pour le moment.</span></div>'}</div></article>
      <article class="monitor-live-card"><h3>Mes séances</h3><div class="monitor-live-list">${sessions.length ? sessions.slice(0, 6).map((session) => `<div class="monitor-live-row"><strong>${formatDateTime(session.scheduledAt)}</strong><small>${Number(session.durationMinutes || 60)} min${session.location ? ` · ${escapeHTML(session.location)}` : ''}</small>${session.focus ? `<span>${escapeHTML(session.focus)}</span>` : ''}${session.comment ? `<span>${escapeHTML(session.comment)}</span>` : ''}</div>`).join('') : '<div class="monitor-live-row"><span>Aucune séance enregistrée.</span></div>'}</div></article>
      <article class="monitor-live-card"><h3>Compte-rendus du moniteur</h3><div class="monitor-live-list">${notes.length ? notes.slice(0, 6).map((note) => `<div class="monitor-live-row"><small>${formatDateTime(note.createdAt)}</small><span>${escapeHTML(note.note)}</span></div>`).join('') : '<div class="monitor-live-row"><span>Aucun compte-rendu partagé.</span></div>'}</div></article>
      <article class="monitor-live-card"><h3>Poser une question</h3><form class="student-question-form" data-student-question-form><textarea maxlength="1500" required placeholder="Ex. Quand dois-je contrôler l’angle mort avant de changer de voie ?"></textarea><button class="primary-action" type="submit">Envoyer au moniteur</button></form></article>
    </div>
    <article class="monitor-live-card"><h3>Mes échanges</h3><div class="monitor-live-list" data-student-questions>${renderStudentQuestions(questions)}</div></article>`;
  view.appendChild(panel);
  panel.querySelector('[data-student-question-form]')?.addEventListener('submit', submitQuestion);
}

async function submitQuestion(event) {
  event.preventDefault();
  if (pending) return;
  const form = event.currentTarget;
  const textarea = form.querySelector('textarea');
  const button = form.querySelector('[type="submit"]');
  const question = textarea.value.trim();
  if (!question) return;
  pending = true;
  button.disabled = true;
  button.textContent = 'Envoi...';
  try {
    await submitStudentCoachingQuestion(question);
    textarea.value = '';
    questionsCache = await loadStudentCoachingQuestions();
    const root = document.querySelector('[data-student-questions]');
    if (root) root.innerHTML = renderStudentQuestions(questionsCache);
    window.eautoToast?.('Question envoyée à ton moniteur.');
  } catch (error) {
    window.eautoToast?.(error.message || 'Envoi impossible.');
  } finally {
    pending = false;
    button.disabled = false;
    button.textContent = 'Envoyer au moniteur';
  }
}

function renderStudentQuestions(items) {
  if (!items?.length) return '<div class="monitor-live-row"><span>Aucune question envoyée.</span></div>';
  return items.slice(0, 10).map((item) => `<div class="student-question-row"><small>${formatDateTime(item.created_at)} · ${item.status === 'open' ? 'En attente' : item.status === 'answered' ? 'Répondu' : 'Clos'}</small><p>${escapeHTML(item.question)}</p>${item.instructor_reply ? `<div class="student-question-reply"><strong>Réponse du moniteur</strong><br>${escapeHTML(item.instructor_reply)}</div>` : ''}</div>`).join('');
}

function readinessMessage(value) {
  if (value >= 85) return 'Tu es proche du niveau examen. Garde la régularité.';
  if (value >= 65) return 'Le socle est solide. Cible maintenant les erreurs récurrentes.';
  if (value >= 40) return 'Bonne progression : continue le parcours et les examens blancs.';
  return 'Construis les bases avec les leçons et quelques entraînements chaque jour.';
}
function clamp(value) { return Math.max(0, Math.min(100, Number(value || 0))); }
function initials(value) { return String(value || 'M').trim().split(/\s+/).slice(0,2).map((part) => part[0] || '').join('').toUpperCase(); }
function formatDate(value) { try { return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(value)); } catch { return String(value || ''); } }
function formatDateTime(value) { try { return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); } catch { return String(value || ''); } }
function formatPhone(value) { const digits = String(value || '').replace(/\D/g, '').replace(/^221/, ''); return digits.length === 9 ? `${digits.slice(0,2)} ${digits.slice(2,5)} ${digits.slice(5,7)} ${digits.slice(7)}` : String(value || ''); }
function normalizePhoneHref(value) { const digits = String(value || '').replace(/\D/g, ''); return digits.startsWith('221') ? `+${digits}` : `+221${digits}`; }
function escapeHTML(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char])); }
function escapeAttr(value) { return escapeHTML(value); }
