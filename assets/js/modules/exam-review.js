import { getAllQuestions, getExam } from './exam-engine.js';
import { navigateTo } from '../router.js';

const STORAGE_KEY = 'examImageReview';
const FILTERS = [
  { id: 'all', label: 'Toutes' },
  { id: 'unreviewed', label: 'À vérifier' },
  { id: 'wrong_image', label: 'Images à remplacer' },
  { id: 'correct', label: 'Vérifiées' }
];

export function renderExamReviewDashboard(container, params, currentUser) {
  const exam = getExam(params.type);
  if (!exam) return renderUnknown(container);
  if (!canReview(exam, currentUser)) return renderReviewBlocked(container, exam);
  setBottomNavVisible(false);

  const questions = getAllQuestions(exam);
  const state = readImageReviewState();
  const counts = countStatuses(exam, questions, state);
  const filter = getFilter();
  const filteredQuestions = getFilteredQuestions(exam, questions, state, filter);
  const showReplacementList = filter === 'wrong_image' && !params.forceQuestion;
  const questionPool = params.forceQuestion ? questions : filteredQuestions;
  const currentQuestion = findCurrentQuestion(exam, questions, questionPool);

  container.innerHTML = `
    <section class="view-stack exam-image-review">
      <button class="text-back" type="button" data-route="/exam/${exam.id}">← ${escapeHTML(exam.title)}</button>
      <div class="view-heading compact">
        <p class="eyebrow">Outil temporaire image review</p>
        <h1>Vérification ${escapeHTML(exam.title)}</h1>
        <p>${counts.reviewed} / ${questions.length} contrôlées · ${counts.progress}%</p>
      </div>
      <div class="image-review-progress">
        <span>À vérifier : <strong>${counts.unreviewed}</strong></span>
        <span>Images à remplacer : <strong>${counts.wrong}</strong></span>
        <span>Vérifiées : <strong>${counts.correct}</strong></span>
      </div>
      <div class="review-filters">
        ${FILTERS.map((item) => `
          <button type="button" data-image-review-filter="${item.id}" class="${filter === item.id ? 'active' : ''}">
            ${escapeHTML(item.label)} ${getFilterCount(item.id, counts, questions.length)}
          </button>
        `).join('')}
      </div>
      ${showReplacementList ? renderWrongImages(exam, filteredQuestions) : renderQuestionPane(exam, questions, questionPool, currentQuestion, filter)}
    </section>
  `;

  bindRouteLinks(container);
  bindFilters(container, exam);
  if (showReplacementList) bindExportActions(container, exam, filteredQuestions);
  if (!showReplacementList && currentQuestion) bindImageQuestionActions(container, exam, questions, questionPool, currentQuestion, filter, currentUser);
}

export function renderExamReviewQuestion(container, params, currentUser) {
  const exam = getExam(params.type);
  if (!exam) return renderUnknown(container);
  if (!canReview(exam, currentUser)) return renderReviewBlocked(container, exam);
  const questions = getAllQuestions(exam);
  const index = questions.findIndex((question) => question.id.toLowerCase() === String(params.questionId || '').toLowerCase());
  if (index < 0) return renderUnknown(container);
  sessionStorage.setItem(currentIndexKey(exam), String(index));
  renderExamReviewDashboard(container, { ...params, forceQuestion: true }, currentUser);
}

function renderQuestionPane(exam, questions, filteredQuestions, current, filter) {
  if (!filteredQuestions.length || !current) {
    return `
      <section class="exam-panel">
        <h2>${filter === 'unreviewed' ? 'Aucune question à vérifier' : 'Aucune question dans ce filtre'}</h2>
        <p>Change de filtre pour continuer la vérification des images.</p>
      </section>
    `;
  }
  return renderImageQuestion(exam, questions, filteredQuestions, current);
}

function renderImageQuestion(exam, questions, filteredQuestions, current) {
  const question = current.question;
  const filteredIndex = filteredQuestions.findIndex((item) => item.id === question.id);
  const previous = filteredQuestions[filteredIndex - 1];
  const next = filteredQuestions[filteredIndex + 1];
  const status = getImageStatus(exam, question.id);
  return `
    <article class="exam-panel review-detail-panel image-review-card">
      <div class="review-detail-heading">
        <div>
          <p class="eyebrow">${escapeHTML(question.id)}</p>
          <h1>${escapeHTML(question.seriesId)} · Question ${question.number}</h1>
        </div>
      </div>
      <section class="review-detail-section">
        <h2>Image</h2>
        ${question.image ? `<img class="exam-question-image" src="${escapeAttribute(question.image)}" alt="" loading="lazy">` : '<p>Aucune image</p>'}
      </section>
      <section class="review-detail-section">
        <h2>Chemin</h2>
        <code>${escapeHTML(question.image || 'Aucun fichier')}</code>
      </section>
      <section class="review-detail-section">
        <h2>Question</h2>
        <p>${escapeHTML(question.text || '')}</p>
      </section>
      <section class="review-detail-section">
        <h2>Réponses</h2>
        ${renderAnswers(question)}
      </section>
      <div class="review-status-actions image-review-actions">
        <button type="button" data-image-review-status="correct" class="${status === 'correct' ? 'active' : ''}">Image correcte</button>
        <button type="button" data-image-review-status="wrong_image" class="${status === 'wrong_image' ? 'active' : ''}">Image à remplacer</button>
      </div>
      <nav class="review-question-nav" aria-label="Navigation image review">
        ${previous ? `<button type="button" data-image-review-go="${escapeHTML(previous.id)}">← Précédente</button>` : '<span></span>'}
        <strong>Question ${current.index + 1} / ${questions.length}</strong>
        ${next ? `<button type="button" data-image-review-go="${escapeHTML(next.id)}">Suivante →</button>` : '<span></span>'}
      </nav>
    </article>
  `;
}

function renderWrongImages(exam, questions) {
  return `
    <section class="exam-panel">
      <div class="card-heading">
        <h2>Images à remplacer : ${questions.length}</h2>
      </div>
      <div class="wrong-image-list">
        ${questions.length ? questions.map((question) => `
          <button type="button" data-route="/exam-image-review/${exam.id}/${question.id}?filter=wrong_image">
            <strong>${escapeHTML(question.id)}</strong>
            <span>${escapeHTML(question.seriesId)}</span>
            <code>${escapeHTML(question.image || 'Aucun fichier')}</code>
          </button>
        `).join('') : '<p>Aucune image marquée à remplacer.</p>'}
      </div>
      <div class="reader-actions">
        <button class="secondary-action" type="button" data-copy-wrong-images>Copier la liste</button>
        <button class="primary-action" type="button" data-export-wrong-images>Exporter JSON</button>
      </div>
      <textarea class="export-buffer" data-export-buffer readonly></textarea>
    </section>
  `;
}

function bindImageQuestionActions(container, exam, questions, filteredQuestions, current, filter, currentUser) {
  const rerender = () => renderExamReviewDashboard(container, { type: exam.id }, currentUser);
  container.querySelectorAll('[data-image-review-status]').forEach((button) => {
    button.addEventListener('click', () => {
      setImageStatus(exam, current.question.id, button.dataset.imageReviewStatus);
      const nextQuestion = findNextAfterDecision(exam, questions, filteredQuestions, current.question, filter);
      const nextIndex = nextQuestion ? questions.findIndex((question) => question.id === nextQuestion.id) : current.index;
      sessionStorage.setItem(currentIndexKey(exam), String(nextIndex));
      rerender();
    });
  });
  container.querySelectorAll('[data-image-review-go]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextIndex = questions.findIndex((question) => question.id === button.dataset.imageReviewGo);
      sessionStorage.setItem(currentIndexKey(exam), String(nextIndex));
      rerender();
    });
  });
  document.onkeydown = (event) => {
    if (!location.hash.includes(`/exam-image-review/${exam.id}`) && !location.hash.includes(`/exam-review/${exam.id}`)) return;
    if (event.key.toLowerCase() === 'c') container.querySelector('[data-image-review-status="correct"]')?.click();
    if (event.key.toLowerCase() === 'x') container.querySelector('[data-image-review-status="wrong_image"]')?.click();
    if (event.key === 'ArrowLeft') container.querySelectorAll('[data-image-review-go]')[0]?.click();
    if (event.key === 'ArrowRight') {
      const targets = container.querySelectorAll('[data-image-review-go]');
      targets[targets.length - 1]?.click();
    }
  };
}

function bindExportActions(container, exam, wrongImages) {
  const data = wrongImages.map((question) => ({
    questionId: question.id,
    series: question.seriesId,
    image: question.image || ''
  }));
  const json = JSON.stringify(data, null, 2);
  const buffer = container.querySelector('[data-export-buffer]');
  if (buffer) buffer.value = json;
  container.querySelector('[data-copy-wrong-images]')?.addEventListener('click', async () => {
    const text = data.map((item) => `${item.questionId} | ${item.series} | ${item.image}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      window.eautoToast?.('Liste copiée');
    } catch (_) {
      if (buffer) {
        buffer.value = text;
        buffer.select();
      }
    }
  });
  container.querySelector('[data-export-wrong-images]')?.addEventListener('click', () => {
    if (buffer) {
      buffer.value = json;
      buffer.hidden = false;
      buffer.select();
    }
  });
}

function bindFilters(container, exam) {
  container.querySelectorAll('[data-image-review-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      const filter = button.dataset.imageReviewFilter;
      navigateTo(filter === 'all' ? `/exam-image-review/${exam.id}` : `/exam-image-review/${exam.id}?filter=${filter}`);
    });
  });
}

function findCurrentQuestion(exam, questions, filteredQuestions) {
  if (!filteredQuestions.length) return null;
  const savedIndex = Math.max(0, Math.min(Number(sessionStorage.getItem(currentIndexKey(exam)) || 0), questions.length - 1));
  const savedQuestion = questions[savedIndex];
  const question = filteredQuestions.some((item) => item.id === savedQuestion?.id) ? savedQuestion : filteredQuestions[0];
  const index = questions.findIndex((item) => item.id === question.id);
  sessionStorage.setItem(currentIndexKey(exam), String(index));
  return { index, question };
}

function countStatuses(exam, questions, state) {
  const correct = questions.filter((question) => getImageStatus(exam, question.id, state) === 'correct').length;
  const wrong = questions.filter((question) => getImageStatus(exam, question.id, state) === 'wrong_image').length;
  const reviewed = correct + wrong;
  return {
    total: questions.length,
    reviewed,
    unreviewed: questions.length - reviewed,
    correct,
    wrong,
    progress: questions.length ? Math.round((reviewed / questions.length) * 100) : 0
  };
}

function readImageReviewState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch (_) {
    return {};
  }
}

function getImageStatus(exam, questionId, state = readImageReviewState()) {
  return state[exam.id]?.[questionId] || 'unreviewed';
}

function setImageStatus(exam, questionId, status) {
  if (!['correct', 'wrong_image'].includes(status)) return;
  const state = readImageReviewState();
  state[exam.id] = { ...(state[exam.id] || {}), [questionId]: status };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function currentIndexKey(exam) {
  return `examImageReview:${exam.id}:index`;
}

function getFilter() {
  const filter = new URLSearchParams(window.location.hash.split('?')[1] || '').get('filter') || 'all';
  return FILTERS.some((item) => item.id === filter) ? filter : 'all';
}

function getFilteredQuestions(exam, questions, state, filter) {
  if (filter === 'all') return questions;
  return questions.filter((question) => getImageStatus(exam, question.id, state) === filter);
}

function getFilterCount(filter, counts, total) {
  if (filter === 'all') return total;
  if (filter === 'unreviewed') return counts.unreviewed;
  if (filter === 'wrong_image') return counts.wrong;
  if (filter === 'correct') return counts.correct;
  return 0;
}

function findNextAfterDecision(exam, questions, filteredQuestions, currentQuestion, filter) {
  if (filter === 'all') {
    const index = questions.findIndex((question) => question.id === currentQuestion.id);
    return questions[Math.min(index + 1, questions.length - 1)];
  }
  const state = readImageReviewState();
  const refreshed = getFilteredQuestions(exam, questions, state, filter);
  if (!refreshed.length) return currentQuestion;
  const currentAllIndex = questions.findIndex((question) => question.id === currentQuestion.id);
  return refreshed.find((question) => questions.findIndex((item) => item.id === question.id) > currentAllIndex) || refreshed[0] || filteredQuestions[0];
}

function canReview(exam, currentUser) {
  return typeof window.canPreviewExam === 'function' && window.canPreviewExam(exam.id, currentUser);
}

function renderAnswers(question) {
  if (question.optionType === 'type3') {
    return `<ul>
      <li>A. ${escapeHTML(question.type3Q1Text1 || '')}</li>
      <li>B. ${escapeHTML(question.type3Q1Text2 || '')}</li>
      <li>C. ${escapeHTML(question.type3Q2Text1 || '')}</li>
      <li>D. ${escapeHTML(question.type3Q2Text2 || '')}</li>
    </ul>`;
  }
  if (question.optionType === 'type4' || question.optionType === 'type4_multiple') {
    return `<ul>${['A', 'B', 'C', 'D'].map((key, index) => {
      const value = question[`type4Text${index + 1}`];
      return value ? `<li>${key}. ${escapeHTML(value)}</li>` : '';
    }).join('')}</ul>`;
  }
  return '<ul><li>A. OUI</li><li>B. NON</li></ul>';
}

function renderReviewBlocked(container, exam) {
  setBottomNavVisible(true);
  container.innerHTML = `
    <section class="view-stack">
      <button class="text-back" type="button" data-route="/home">← Retour</button>
      <div class="empty-state">
        <h1>Outil image review verrouillé</h1>
        <p>Un accès temporaire est nécessaire pour vérifier les images de ${escapeHTML(exam.title)}.</p>
      </div>
    </section>
  `;
  bindRouteLinks(container);
  window.setTimeout(() => window.openExamAccessModal?.(exam.id), 0);
}

function renderUnknown(container) {
  container.innerHTML = '<section class="empty-state"><h1>Question introuvable</h1></section>';
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
