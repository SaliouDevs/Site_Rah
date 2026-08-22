import { registerRoute, navigateTo } from './router.js';
import { startAccountSessionGuard } from './services/session-service.js';
import { awardLearningPoints, getDailyKey, getLearningDashboard, getLearningProfile, saveLearningProfile } from './services/learning-service.js';
import { getDailyQuestions, getQuestionOfDay, getSituationQuestions, getSpeedQuestions, recordTrainingAnswer } from './services/training-service.js';

let currentUser = null;
let sessionGuardStarted = false;
let dashboardCache = null;
let dashboardCacheAt = 0;
let lastAwardedExamMarker = '';

registerRoute('/daily-challenge', () => renderChallenge('daily'));
registerRoute('/speed-challenge', () => renderChallenge('speed'));
registerRoute('/smart-review', renderSmartReview);
registerRoute('/situations', renderSituations);
registerRoute('/start', renderOnboarding);
registerRoute('/monitor', renderMonitorSpace);

document.addEventListener('DOMContentLoaded', bootstrapEnhancements);
window.addEventListener('hashchange', () => window.setTimeout(enhanceCurrentView, 40));
window.addEventListener('learning-points-updated', () => { dashboardCache = null; enhanceCurrentView(); });

async function bootstrapEnhancements() {
  await waitForAppUser();
  currentUser = window.EAUTO_CURRENT_USER;
  if (!currentUser || currentUser.isAdmin || currentUser.isDevUser) {
    enhanceCurrentView();
    return;
  }
  if (!sessionGuardStarted) {
    sessionGuardStarted = true;
    startAccountSessionGuard({ user: await window.sbGetUser?.() });
  }
  await maybeGuideNewStudent();
  observeAppView();
  enhanceCurrentView();
}

async function waitForAppUser() {
  for (let i = 0; i < 80; i += 1) {
    if (window.EAUTO_CURRENT_USER) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function observeAppView() {
  const root = document.getElementById('app-view');
  if (!root) return;
  const observer = new MutationObserver(() => {
    window.clearTimeout(observeAppView.timer);
    observeAppView.timer = window.setTimeout(enhanceCurrentView, 35);
  });
  observer.observe(root, { childList: true, subtree: true });
}

async function maybeGuideNewStudent() {
  const profile = await getLearningProfile();
  if (profile?.onboarding_completed) return;
  if (sessionStorage.getItem('eautoecole.onboardingSeenThisSession') === '1') return;
  sessionStorage.setItem('eautoecole.onboardingSeenThisSession', '1');
  window.setTimeout(() => navigateTo('/start'), 120);
}

async function enhanceCurrentView() {
  const path = location.hash.replace(/^#/, '').split('?')[0] || '/home';
  if (path === '/home') await enhanceHome();
  if (path === '/progress') await enhanceProgress();
  detectSuccessfulExam();
}

async function loadDashboard(force = false) {
  if (!force && dashboardCache && Date.now() - dashboardCacheAt < 15000) return dashboardCache;
  dashboardCache = await getLearningDashboard();
  dashboardCacheAt = Date.now();
  return dashboardCache;
}

async function enhanceHome() {
  const root = document.querySelector('.home-view');
  if (!root || root.querySelector('[data-learning-hub]')) return;
  const dashboard = await loadDashboard();
  const daily = getQuestionOfDay();
  const firstSection = root.querySelector('.continue-card') || root.firstElementChild;
  const hub = document.createElement('section');
  hub.className = 'learning-hub';
  hub.dataset.learningHub = 'true';
  hub.innerHTML = `
    <div class="learning-hub-head">
      <div><p class="eyebrow">Mon entraînement</p><h2>${Number(dashboard.points || 0)} points</h2></div>
      <button class="secondary-action compact-action" type="button" data-enhancement-route="/smart-review">Révision intelligente</button>
    </div>
    <div class="training-grid">
      <button class="training-card daily" type="button" data-enhancement-route="/daily-challenge"><i class="fas fa-bullseye"></i><strong>Défi du jour</strong><span>10 questions · objectif 8/10</span></button>
      <button class="training-card speed" type="button" data-enhancement-route="/speed-challenge"><i class="fas fa-bolt"></i><strong>Défi 60 secondes</strong><span>Réponds au maximum</span></button>
      <button class="training-card situations" type="button" data-enhancement-route="/situations"><i class="fas fa-road"></i><strong>Situations réelles</strong><span>Que devez-vous faire ?</span></button>
    </div>
    ${daily ? `<article class="question-day-card"><div><p class="eyebrow">Question du jour</p><strong>${escapeHTML(daily.text)}</strong></div><button class="primary-action compact-action" type="button" data-enhancement-route="/daily-challenge">Répondre</button></article>` : ''}
  `;
  firstSection?.insertAdjacentElement('afterend', hub);
  bindEnhancementRoutes(hub);
}

async function enhanceProgress() {
  const root = document.getElementById('app-view');
  const stack = root?.querySelector('.view-stack');
  if (!stack || stack.querySelector('[data-smart-progress]')) return;
  const dashboard = await loadDashboard();
  const answered = Number(dashboard.answered || 0);
  const accuracy = answered ? Math.round((Number(dashboard.correct || 0) / answered) * 100) : 0;
  const weak = Array.isArray(dashboard.weakTopics) ? dashboard.weakTopics : [];
  const section = document.createElement('section');
  section.className = 'smart-progress-card';
  section.dataset.smartProgress = 'true';
  section.innerHTML = `
    <div class="section-heading"><div><p class="eyebrow">Analyse intelligente</p><h2>${Number(dashboard.points || 0)} points · ${accuracy}% de précision</h2></div><button class="secondary-action compact-action" data-enhancement-route="/smart-review">Réviser</button></div>
    <div class="weak-topic-list">${weak.length ? weak.map((item) => `<span><strong>${escapeHTML(item.topic)}</strong><small>${Number(item.accuracy || 0)}% · ${Number(item.attempts || 0)} réponses</small></span>`).join('') : '<p>Fais quelques tests ou défis pour que la plateforme détecte tes points faibles.</p>'}</div>`;
  stack.appendChild(section);
  bindEnhancementRoutes(section);
}

function renderOnboarding() {
  const container = document.getElementById('app-view');
  if (!container) return;
  setBottomNavVisible(false);
  container.innerHTML = `
    <section class="guided-start immersive-view">
      <div class="guided-start-card">
        <div class="guided-icon"><i class="fas fa-route"></i></div>
        <p class="eyebrow">Bienvenue sur eAutoecole</p>
        <h1>On te guide pour bien commencer.</h1>
        <p>Le parcours conseillé : apprendre les bases, faire les tests, puis passer aux examens blancs. La plateforme adapte ensuite les révisions à tes erreurs.</p>
        <div class="guided-steps">
          <span><b>1</b><strong>Leçons</strong><small>Comprendre les règles · +10 pts par leçon maîtrisée</small></span>
          <span><b>2</b><strong>Tests</strong><small>S'entraîner · +20 pts par test réussi</small></span>
          <span><b>3</b><strong>Examens blancs</strong><small>Se mettre en condition · +50 pts par réussite</small></span>
        </div>
        <label class="guided-choice">Je prépare surtout
          <select data-license-choice><option value="light">Permis B · Poids léger</option><option value="heavy">Permis C · Poids lourd</option><option value="both">Les deux</option></select>
        </label>
        <div class="reader-actions"><button class="primary-action" type="button" data-start-learning>Commencer par les leçons</button><button class="secondary-action" type="button" data-skip-guide>Explorer l'accueil</button></div>
      </div>
    </section>`;
  const finish = async (route) => {
    const preferred = container.querySelector('[data-license-choice]')?.value || 'light';
    await saveLearningProfile({ onboarding_completed: true, preferred_license: preferred }).catch(() => {});
    setBottomNavVisible(true);
    navigateTo(route);
  };
  container.querySelector('[data-start-learning]')?.addEventListener('click', () => finish('/lessons'));
  container.querySelector('[data-skip-guide]')?.addEventListener('click', () => finish('/home'));
}

async function renderSmartReview() {
  const container = document.getElementById('app-view');
  if (!container) return;
  setBottomNavVisible(true);
  const dashboard = await loadDashboard(true);
  const weak = Array.isArray(dashboard.weakTopics) ? dashboard.weakTopics : [];
  container.innerHTML = `
    <section class="view-stack smart-review-view">
      <button class="text-back" type="button" data-enhancement-route="/home">← Accueil</button>
      <div class="view-heading"><p class="eyebrow">Révision intelligente</p><h1>Travaille ce qui te fait perdre des points</h1><p>L'analyse se base sur tes réponses enregistrées, pas sur une estimation au hasard.</p></div>
      <div class="smart-review-summary"><span><small>Points</small><strong>${Number(dashboard.points || 0)}</strong></span><span><small>Réponses analysées</small><strong>${Number(dashboard.answered || 0)}</strong></span></div>
      <section class="weak-topics-panel"><h2>Priorités de révision</h2>${weak.length ? weak.map((item, index) => `<article><b>${index + 1}</b><div><strong>${escapeHTML(item.topic)}</strong><span>${Number(item.accuracy || 0)}% de bonnes réponses sur ${Number(item.attempts || 0)} essais</span></div></article>`).join('') : '<div class="empty-smart-state"><i class="fas fa-chart-line"></i><strong>Pas encore assez de données</strong><p>Fais au moins quelques tests ou défis. Dès qu’un thème revient plusieurs fois, il apparaît ici.</p></div>'}</section>
      <div class="training-grid"><button class="training-card daily" data-enhancement-route="/daily-challenge"><strong>Défi du jour</strong><span>Génère des données utiles</span></button><button class="training-card situations" data-enhancement-route="/situations"><strong>Situations réelles</strong><span>Applique les règles</span></button></div>
    </section>`;
  bindEnhancementRoutes(container);
}

function renderChallenge(mode) {
  const container = document.getElementById('app-view');
  if (!container) return;
  const speed = mode === 'speed';
  const questions = speed ? getSpeedQuestions() : getDailyQuestions(10);
  const state = { index: 0, score: 0, answered: 0, remaining: 60, done: false, timer: null, questions };
  setBottomNavVisible(false);

  const finish = () => {
    if (state.done) return;
    state.done = true;
    if (state.timer) clearInterval(state.timer);
    const goal = speed ? null : state.score >= 8;
    container.innerHTML = `<section class="challenge-result immersive-view"><div class="reader-panel result-panel ${goal === false ? 'failed' : 'passed'}"><p class="eyebrow">${speed ? 'Défi 60 secondes' : 'Défi du jour'}</p><h1>${state.score} bonne${state.score > 1 ? 's' : ''} réponse${state.score > 1 ? 's' : ''}</h1><p>${speed ? `${state.answered} questions tentées en 60 secondes.` : `${state.score}/10 · objectif 8/10 ${goal ? 'atteint' : 'à retenter'}.`}</p><div class="reader-actions"><button class="primary-action" data-retry-challenge>Recommencer</button><button class="secondary-action" data-enhancement-route="/home">Accueil</button></div></div></section>`;
    container.querySelector('[data-retry-challenge]')?.addEventListener('click', () => renderChallenge(mode));
    bindEnhancementRoutes(container);
  };

  const render = () => {
    if (state.done) return;
    if (state.index >= state.questions.length) return finish();
    const q = state.questions[state.index];
    container.innerHTML = `<section class="challenge-active immersive-view"><div class="challenge-topbar"><button class="text-back" data-enhancement-route="/home">← Quitter</button><strong>${speed ? `<span data-speed-time>${state.remaining}s</span>` : `Question ${state.index + 1}/10`}</strong><span>${state.score} ✓</span></div><article class="challenge-question-card">${q.image ? `<img src="${escapeAttribute(q.image)}" alt="" class="question-image">` : ''}<p class="eyebrow">${speed ? 'Réponds vite' : 'Défi du jour'}</p><h1>${escapeHTML(q.text)}</h1><div class="test-options">${Object.entries(q.options).map(([key, label]) => `<button type="button" data-challenge-answer="${key}"><span>${key}</span><strong>${escapeHTML(label)}</strong></button>`).join('')}</div><div class="quiz-feedback" data-challenge-feedback></div></article></section>`;
    bindEnhancementRoutes(container);
    container.querySelectorAll('[data-challenge-answer]').forEach((button) => button.addEventListener('click', async () => {
      if (button.closest('.test-options')?.dataset.locked) return;
      button.closest('.test-options').dataset.locked = '1';
      const correct = button.dataset.challengeAnswer === q.correctAnswer;
      state.answered += 1;
      if (correct) state.score += 1;
      await recordTrainingAnswer({ mode: speed ? 'speed' : 'daily', question: q, answer: button.dataset.challengeAnswer, correct, index: state.index + 1 });
      if (speed) { state.index += 1; render(); return; }
      const feedback = container.querySelector('[data-challenge-feedback]');
      feedback.className = `quiz-feedback ${correct ? 'correct' : 'wrong'}`;
      feedback.innerHTML = `<strong>${correct ? 'Correct' : 'À revoir'}</strong><span>${escapeHTML(q.explanation || `Réponse ${q.correctAnswer}`)}</span>`;
      container.querySelectorAll('[data-challenge-answer]').forEach((item) => { item.disabled = true; if (item.dataset.challengeAnswer === q.correctAnswer) item.classList.add('correct'); else if (item === button && !correct) item.classList.add('wrong'); });
      const next = document.createElement('button'); next.className = 'primary-action challenge-next'; next.textContent = state.index === 9 ? 'Voir le résultat' : 'Suivant';
      next.addEventListener('click', () => { state.index += 1; render(); });
      container.querySelector('.challenge-question-card').appendChild(next);
    }));
  };

  render();
  if (speed) {
    state.timer = setInterval(() => {
      state.remaining -= 1;
      const label = container.querySelector('[data-speed-time]');
      if (label) label.textContent = `${state.remaining}s`;
      if (state.remaining <= 0) finish();
    }, 1000);
  }
}

function renderSituations() {
  const container = document.getElementById('app-view');
  if (!container) return;
  setBottomNavVisible(false);
  const questions = getSituationQuestions();
  let index = 0;
  let score = 0;
  const render = () => {
    if (index >= questions.length) {
      container.innerHTML = `<section class="challenge-result immersive-view"><div class="reader-panel result-panel passed"><p class="eyebrow">Situations réelles</p><h1>${score}/${questions.length}</h1><p>Tu as appliqué les règles à des scènes visuelles de circulation.</p><div class="reader-actions"><button class="primary-action" data-enhancement-route="/home">Retour à l'accueil</button></div></div></section>`; bindEnhancementRoutes(container); return;
    }
    const q = questions[index];
    container.innerHTML = `<section class="challenge-active immersive-view"><div class="challenge-topbar"><button class="text-back" data-enhancement-route="/home">← Quitter</button><strong>Situation ${index + 1}/${questions.length}</strong></div><article class="challenge-question-card situation-card"><img src="${escapeAttribute(q.image)}" alt="Situation de circulation" class="situation-image"><p class="eyebrow">Que devez-vous faire ?</p><h1>${escapeHTML(q.text)}</h1><div class="test-options">${Object.entries(q.options).map(([key, label]) => `<button data-situation-answer="${key}"><span>${key}</span><strong>${escapeHTML(label)}</strong></button>`).join('')}</div><div class="quiz-feedback" data-situation-feedback></div></article></section>`;
    bindEnhancementRoutes(container);
    container.querySelectorAll('[data-situation-answer]').forEach((button) => button.addEventListener('click', async () => {
      const correct = button.dataset.situationAnswer === q.correctAnswer;
      if (correct) score += 1;
      await recordTrainingAnswer({ mode: 'situation', question: q, answer: button.dataset.situationAnswer, correct, index: index + 1 });
      container.querySelectorAll('[data-situation-answer]').forEach((item) => { item.disabled = true; if (item.dataset.situationAnswer === q.correctAnswer) item.classList.add('correct'); else if (item === button && !correct) item.classList.add('wrong'); });
      const feedback = container.querySelector('[data-situation-feedback]'); feedback.className = `quiz-feedback ${correct ? 'correct' : 'wrong'}`; feedback.innerHTML = `<strong>${correct ? 'Bonne décision' : 'À revoir'}</strong><span>${escapeHTML(q.explanation || '')}</span>`;
      const next = document.createElement('button'); next.className = 'primary-action challenge-next'; next.textContent = 'Situation suivante'; next.addEventListener('click', () => { index += 1; render(); }); container.querySelector('.situation-card').appendChild(next);
    }));
  };
  render();
}

function renderMonitorSpace() {
  const container = document.getElementById('app-view');
  if (!container) return;
  setBottomNavVisible(true);
  container.innerHTML = `<section class="view-stack monitor-space"><button class="text-back" data-enhancement-route="/home">← Accueil</button><div class="view-heading"><p class="eyebrow">Espace Moniteur</p><h1>Accompagnement humain</h1><p>Prépare les points à revoir avec ton moniteur sans remplacer son jugement.</p></div><div class="monitor-grid"><article><i class="fas fa-chart-line"></i><strong>Points faibles</strong><span>Le moniteur peut s'appuyer sur la révision intelligente.</span></article><article><i class="fas fa-comments"></i><strong>Questions à poser</strong><span>Note les situations que tu n'as pas comprises pendant ta révision.</span></article><article><i class="fas fa-car"></i><strong>Avant la conduite</strong><span>Utilise tes résultats pour cibler la prochaine séance.</span></article></div><div class="cms-inline-notice">Cet espace est prêt côté élève. La gestion complète des moniteurs (comptes, affectations, commentaires) sera activée seulement avec un vrai rôle moniteur et des règles d'accès dédiées, pas avec un faux écran non sécurisé.</div></section>`;
  bindEnhancementRoutes(container);
}

async function detectSuccessfulExam() {
  const panel = document.querySelector('.exam-result-view .result-panel.passed');
  if (!panel) return;
  const path = location.hash.replace(/^#/, '').split('?')[0];
  const match = path.match(/^\/exam\/([^/]+)\/series\/([^/]+)/);
  if (!match) return;
  const marker = `${match[1]}:${match[2]}:${getDailyKey()}`;
  if (lastAwardedExamMarker === marker) return;
  lastAwardedExamMarker = marker;
  const scoreText = panel.querySelector('h1')?.textContent || '';
  await awardLearningPoints({ sourceKey: `exam:${marker}`, kind: 'exam', points: 50, metadata: { exam: match[1], series: match[2], score: scoreText } });
  const p = panel.querySelector('p:last-of-type');
  if (p && !p.textContent.includes('+50')) p.textContent += ' · +50 points';
}

function bindEnhancementRoutes(root) {
  root.querySelectorAll('[data-enhancement-route]').forEach((button) => {
    if (button.dataset.boundRoute) return;
    button.dataset.boundRoute = '1';
    button.addEventListener('click', () => navigateTo(button.dataset.enhancementRoute));
  });
}
function setBottomNavVisible(visible) { const nav = document.getElementById('bottom-nav'); if (nav) nav.style.display = visible ? 'flex' : 'none'; }
function escapeHTML(text) { return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;'); }
function escapeAttribute(text) { return escapeHTML(text).replace(/`/g, '&#x60;'); }
