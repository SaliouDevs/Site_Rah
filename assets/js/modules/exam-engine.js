import { EXAM_LIGHT_DATA } from '../data/exam-light-data.js';
import { EXAM_HEAVY_DATA } from '../data/exam-heavy-data.js';
import { navigateTo } from '../router.js';

export const EXAM_DATA = {
  light: EXAM_LIGHT_DATA,
  heavy: EXAM_HEAVY_DATA
};

let activeExam = null;

export function renderExamsView(container, currentUser) {
  setBottomNavVisible(true);
  activeExam = null;
  container.innerHTML = `
    <section class="view-stack exams-view">
      <div class="view-heading">
        <p class="eyebrow">Préparation examens</p>
        <h1>Examens</h1>
        <p>Les examens Poids léger et Poids lourd restent en correction. La prévisualisation est réservée à l'administration et au développement local.</p>
      </div>
      <div class="exam-grid">
        ${renderExamEntry(EXAM_LIGHT_DATA, currentUser)}
        ${renderExamEntry(EXAM_HEAVY_DATA, currentUser)}
      </div>
    </section>
  `;
  bindExamEntries(container, currentUser);
}

export function renderExamHome(container, params, currentUser) {
  const exam = getExam(params.type);
  if (!exam) return renderUnknownExam(container);
  setBottomNavVisible(true);
  activeExam = null;
  if (!canAccess(exam, currentUser)) return renderExamBlocked(container, exam);

  const history = readHistory(exam);
  const latest = history[0];
  const totalQuestions = getAllQuestions(exam).length;
  const imageCount = new Set(getAllQuestions(exam).map((q) => q.image).filter(Boolean)).size;
  container.innerHTML = `
    <section class="view-stack exam-home-view">
      <button class="text-back" type="button" data-route="/exams">← Préparation examens</button>
      <div class="view-heading compact">
        <p class="eyebrow">${escapeHTML(exam.license)}</p>
        <h1>${escapeHTML(exam.title)}</h1>
        <p>Prépare-toi dans les conditions de l'examen avec les séries existantes.</p>
      </div>
      <div class="exam-summary-grid">
        <section class="metric-card"><span>Questions</span><strong>${totalQuestions}</strong></section>
        <section class="metric-card"><span>Séries</span><strong>${exam.series.length}</strong></section>
        <section class="metric-card"><span>Images</span><strong>${imageCount}</strong></section>
        <section class="metric-card"><span>Réussite</span><strong>${exam.passingScore}/${exam.series[0]?.questionCount || 0}</strong></section>
      </div>
      <section class="exam-panel">
        <div class="card-heading">
          <h2>Progression</h2>
          <button class="secondary-action compact" type="button" data-route="/exam-review/${exam.id}">Review</button>
        </div>
        <div class="exam-history-note">
          <strong>Dernière tentative</strong>
          <span>${latest ? `${latest.seriesId} · ${latest.score}/${latest.total} · ${latest.percentage}%` : 'Aucune tentative enregistrée'}</span>
        </div>
      </section>
      <section class="exam-panel">
        <div class="section-heading"><h2>Séries</h2></div>
        <div class="exam-series-grid">
          ${exam.series.map((series) => `
            <button class="exam-series-card" type="button" data-start-exam-series="${series.id}">
              <strong>${escapeHTML(series.id)}</strong>
              <span>${series.questionCount} questions</span>
              <small>${series.durationMinutes} min · réussite ${series.passingScore}/${series.questionCount}</small>
            </button>
          `).join('')}
        </div>
      </section>
    </section>
  `;
  bindRouteLinks(container);
  container.querySelectorAll('[data-start-exam-series]').forEach((button) => {
    button.addEventListener('click', () => navigateTo(`/exam/${exam.id}/series/${button.dataset.startExamSeries}`));
  });
}

export function renderExamSeries(container, params, currentUser) {
  const exam = getExam(params.type);
  if (!exam) return renderUnknownExam(container);
  if (!canAccess(exam, currentUser)) return renderExamBlocked(container, exam);
  const series = getSeries(exam, params.seriesId);
  if (!series) return renderUnknownExam(container);

  setBottomNavVisible(false);
  activeExam = {
    exam,
    series,
    currentIndex: 0,
    answers: {},
    validated: {}
  };
  renderActiveQuestion(container);
}

function renderActiveQuestion(container) {
  const { exam, series, currentIndex, answers, validated } = activeExam;
  const question = series.questions[currentIndex];
  const answer = answers[currentIndex];
  const isValidated = Boolean(validated[currentIndex]);
  const progress = Math.round(((currentIndex + 1) / series.questions.length) * 100);
  container.innerHTML = `
    <section class="exam-active-view immersive-view">
      <div class="exam-active-topbar">
        <button class="text-back" type="button" data-quit-exam>← Quitter</button>
        <div>
          <strong>${escapeHTML(exam.title)} · ${escapeHTML(series.id)}</strong>
          <span>Question ${currentIndex + 1} / ${series.questions.length}</span>
        </div>
      </div>
      <div class="exam-progress-track"><span style="width:${progress}%"></span></div>
      <article class="exam-question-panel">
        ${question.image ? `<img class="exam-question-image" src="${escapeAttribute(question.image)}" alt="" loading="lazy">` : ''}
        <div class="exam-question-meta"><span>${escapeHTML(question.id)}</span><strong>Question ${currentIndex + 1}</strong></div>
        <h1>${escapeHTML(question.text || '')}</h1>
        <div class="exam-options">
          ${renderQuestionOptions(question, answer, isValidated)}
        </div>
        <div class="reader-actions">
          ${isValidated
            ? `<button class="primary-action" type="button" data-next-exam-question>${currentIndex === series.questions.length - 1 ? 'Voir le résultat' : 'Question suivante'}</button>`
            : `<button class="primary-action" type="button" data-validate-exam-answer ${isAnswered(question, answer) ? '' : 'disabled'}>Valider</button>`}
        </div>
      </article>
    </section>
  `;
  bindActiveQuestion(container);
}

function bindActiveQuestion(container) {
  const { exam, series, currentIndex } = activeExam;
  const question = series.questions[currentIndex];
  container.querySelector('[data-quit-exam]').addEventListener('click', () => {
    window.eautoConfirm({
      title: "Quitter l'examen ?",
      message: 'Ta tentative actuelle ne sera pas terminée.',
      confirmLabel: 'Quitter',
      cancelLabel: 'Continuer',
      onConfirm: () => {
        activeExam = null;
        setBottomNavVisible(true);
        navigateTo(`/exam/${exam.id}`);
      }
    });
  });

  container.querySelectorAll('[data-exam-answer]').forEach((button) => {
    button.addEventListener('click', () => {
      if (activeExam.validated[currentIndex]) return;
      const value = button.dataset.examAnswer;
      const group = button.dataset.examGroup;
      if (question.optionType === 'type4_multiple') {
        const selected = new Set(activeExam.answers[currentIndex] || []);
        selected.has(value) ? selected.delete(value) : selected.add(value);
        activeExam.answers[currentIndex] = [...selected];
      } else if (group) {
        activeExam.answers[currentIndex] = { ...(activeExam.answers[currentIndex] || {}), [group]: value };
      } else {
        activeExam.answers[currentIndex] = value;
      }
      renderActiveQuestion(container);
    });
  });

  const validate = container.querySelector('[data-validate-exam-answer]');
  if (validate) {
    validate.addEventListener('click', () => {
      activeExam.validated[currentIndex] = true;
      renderActiveQuestion(container);
    });
  }

  const next = container.querySelector('[data-next-exam-question]');
  if (next) {
    next.addEventListener('click', () => {
      if (currentIndex === series.questions.length - 1) {
        renderExamResult(container);
      } else {
        activeExam.currentIndex += 1;
        renderActiveQuestion(container);
      }
    });
  }
}

function renderExamResult(container) {
  const { exam, series, answers } = activeExam;
  const score = series.questions.reduce((sum, question, index) => sum + (isCorrect(question, answers[index]) ? 1 : 0), 0);
  const percentage = Math.round((score / series.questions.length) * 100);
  const passed = score >= series.passingScore;
  saveHistory(exam, { seriesId: series.id, score, total: series.questions.length, percentage, passed, date: new Date().toISOString() });
  setBottomNavVisible(false);
  container.innerHTML = `
    <section class="exam-result-view immersive-view">
      <div class="reader-panel result-panel ${passed ? 'passed' : 'failed'}">
        <p class="eyebrow">Résultat</p>
        <h1>${score} / ${series.questions.length}</h1>
        <p>${percentage} % · ${passed ? 'Examen réussi' : 'Examen à revoir'}</p>
        <div class="reader-actions">
          <button class="primary-action" type="button" data-show-corrections>Voir les corrections</button>
          <button class="secondary-action" type="button" data-exam-home>Retour aux séries</button>
        </div>
      </div>
    </section>
  `;
  container.querySelector('[data-show-corrections]').addEventListener('click', () => renderCorrections(container));
  container.querySelector('[data-exam-home]').addEventListener('click', () => {
    activeExam = null;
    setBottomNavVisible(true);
    navigateTo(`/exam/${exam.id}`);
  });
}

function renderCorrections(container) {
  const { exam, series, answers } = activeExam;
  container.innerHTML = `
    <section class="view-stack exam-corrections-view">
      <button class="text-back" type="button" data-back-result>← Résultat</button>
      <div class="view-heading compact">
        <p class="eyebrow">Correction</p>
        <h1>${escapeHTML(exam.title)} · ${escapeHTML(series.id)}</h1>
      </div>
      <div class="exam-correction-list">
        ${series.questions.map((question, index) => `
          <article class="exam-correction-card ${isCorrect(question, answers[index]) ? 'correct' : 'wrong'}">
            <div class="exam-question-meta"><span>${escapeHTML(question.id)}</span><strong>${isCorrect(question, answers[index]) ? 'Correct' : 'À revoir'}</strong></div>
            <p>${escapeHTML(question.text || '')}</p>
            <dl>
              <div><dt>Ta réponse</dt><dd>${escapeHTML(formatAnswer(question, answers[index]))}</dd></div>
              <div><dt>Réponse correcte</dt><dd>${escapeHTML(formatCorrectAnswer(question))}</dd></div>
            </dl>
          </article>
        `).join('')}
      </div>
      <div class="reader-actions">
        <button class="secondary-action" type="button" data-exam-home>Retour aux séries</button>
      </div>
    </section>
  `;
  setBottomNavVisible(true);
  container.querySelector('[data-back-result]').addEventListener('click', () => renderExamResult(container));
  container.querySelector('[data-exam-home]').addEventListener('click', () => {
    activeExam = null;
    navigateTo(`/exam/${exam.id}`);
  });
}

function renderExamEntry(exam, currentUser) {
  const canPreview = canAccess(exam, currentUser);
  return `
    <button class="nav-card exam-card ${isEnabled(exam) ? '' : 'exam-unavailable'}" type="button" data-exam-entry="${exam.id}" aria-disabled="${isEnabled(exam) || canPreview ? 'false' : 'true'}">
      <span class="exam-license">${escapeHTML(exam.license)}</span>
      <strong>${escapeHTML(exam.title)}</strong>
      <span class="exam-status-badge"><i class="fas fa-screwdriver-wrench"></i> En correction</span>
      ${canPreview ? '<span class="exam-preview-label">Prévisualiser</span>' : ''}
    </button>
  `;
}

function bindExamEntries(container, currentUser) {
  container.querySelectorAll('[data-exam-entry]').forEach((button) => {
    button.addEventListener('click', () => {
      const exam = getExam(button.dataset.examEntry);
      if (exam && canAccess(exam, currentUser)) {
        navigateTo(`/exam/${exam.id}`);
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

function renderExamBlocked(container, exam) {
  setBottomNavVisible(true);
  activeExam = null;
  container.innerHTML = `
    <section class="view-stack">
      <button class="text-back" type="button" data-route="/exams">← Préparation examens</button>
      <div class="empty-state">
        <i class="fas fa-screwdriver-wrench"></i>
        <h1>${escapeHTML(exam.title)} est en correction</h1>
        <p>Cet examen n'est pas encore disponible pour les élèves.</p>
      </div>
    </section>
  `;
  bindRouteLinks(container);
}

function renderUnknownExam(container) {
  setBottomNavVisible(true);
  container.innerHTML = '<section class="empty-state"><h1>Examen introuvable</h1></section>';
}

function renderQuestionOptions(question, answer, isValidated) {
  if (question.optionType === 'type3') {
    return [1, 2].map((groupIndex) => {
      const firstKey = groupIndex === 1 ? 'A' : 'C';
      const secondKey = groupIndex === 1 ? 'B' : 'D';
      const firstText = groupIndex === 1 ? question.type3Q1Text1 : question.type3Q2Text1;
      const secondText = groupIndex === 1 ? question.type3Q1Text2 : question.type3Q2Text2;
      const title = groupIndex === 1 ? question.type3Q1Title : question.type3Q2Title;
      return `
        <div class="exam-option-group">
          <strong>${escapeHTML(title || `Partie ${groupIndex}`)}</strong>
          ${renderOptionButton(firstKey, firstText, answer?.[String(groupIndex)], isValidated, String(groupIndex))}
          ${renderOptionButton(secondKey, secondText, answer?.[String(groupIndex)], isValidated, String(groupIndex))}
        </div>
      `;
    }).join('');
  }
  if (question.optionType === 'type4' || question.optionType === 'type4_multiple') {
    return ['A', 'B', 'C', 'D'].map((key, index) => {
      const text = question[`type4Text${index + 1}`];
      if (!text) return '';
      const selected = Array.isArray(answer) ? answer.includes(key) : answer === key;
      return renderOptionButton(key, text, selected ? key : answer, isValidated);
    }).join('');
  }
  return renderOptionButton('A', 'OUI', answer, isValidated) + renderOptionButton('B', 'NON', answer, isValidated);
}

function renderOptionButton(key, text, answer, isValidated, group = '') {
  const selected = answer === key;
  return `
    <button class="${selected ? 'selected' : ''}" type="button" data-exam-answer="${key}" ${group ? `data-exam-group="${group}"` : ''} ${isValidated ? 'disabled' : ''}>
      <span>${key}</span>
      <strong>${escapeHTML(text || '')}</strong>
    </button>
  `;
}

function isAnswered(question, answer) {
  if (question.optionType === 'type3') return Boolean(answer?.['1'] && answer?.['2']);
  if (question.optionType === 'type4_multiple') return Array.isArray(answer) && answer.length > 0;
  return Boolean(answer);
}

function isCorrect(question, answer) {
  if (question.optionType === 'type3') {
    return answer?.['1'] === question.type3CorrectAnswer1 && answer?.['2'] === question.type3CorrectAnswer2;
  }
  if (question.optionType === 'type4_multiple') {
    const selected = [...(answer || [])].sort().join('|');
    const correct = [...(question.correctAnswer || [])].sort().join('|');
    return selected === correct;
  }
  return answer === question.correctAnswer;
}

export function getExam(type) {
  return EXAM_DATA[window.normalizeExamId?.(type) || type] || null;
}

export function getAllQuestions(exam) {
  return exam.series.flatMap((series) => series.questions);
}

export function getSeries(exam, seriesId) {
  return exam.series.find((series) => series.id.toLowerCase() === String(seriesId || '').toLowerCase());
}

function canAccess(exam, currentUser) {
  return typeof window.canAccessExam === 'function' && window.canAccessExam(exam.id, currentUser);
}

function isEnabled(exam) {
  return typeof window.isExamEnabled === 'function' && window.isExamEnabled(exam.id);
}

function saveHistory(exam, item) {
  const history = readHistory(exam);
  history.unshift(item);
  localStorage.setItem(exam.historyKey, JSON.stringify(history.slice(0, 8)));
}

function readHistory(exam) {
  try {
    return JSON.parse(localStorage.getItem(exam.historyKey) || '[]');
  } catch (_) {
    return [];
  }
}

function formatAnswer(question, answer) {
  if (!answer) return 'Non répondue';
  if (question.optionType === 'type3') return `1: ${answer['1'] || '-'}, 2: ${answer['2'] || '-'}`;
  if (Array.isArray(answer)) return answer.join(', ');
  return answer;
}

function formatCorrectAnswer(question) {
  if (question.optionType === 'type3') return `1: ${question.type3CorrectAnswer1 || '-'}, 2: ${question.type3CorrectAnswer2 || '-'}`;
  if (Array.isArray(question.correctAnswer)) return question.correctAnswer.join(', ');
  return question.correctAnswer || '-';
}

function bindRouteLinks(root) {
  root.querySelectorAll('[data-route]').forEach((button) => {
    button.addEventListener('click', () => navigateTo(button.dataset.route));
  });
}

function setBottomNavVisible(isVisible) {
  const nav = document.getElementById('bottom-nav');
  if (nav) nav.style.display = isVisible ? 'flex' : 'none';
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
