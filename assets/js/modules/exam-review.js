import { getAllQuestions, getExam } from './exam-engine.js';
import { navigateTo } from '../router.js';

const STORAGE_KEY = 'examImageReview';

export function renderExamReviewDashboard(container, params, currentUser) {
  const exam = getExam(params.type);
  if (!exam) return renderUnknown(container);
  if (!canReview(exam, currentUser)) return renderReviewBlocked(container, exam);
  setBottomNavVisible(false);

  const questions = getAllQuestions(exam);
  const state = readImageReviewState();
  const counts = countStatuses(exam, questions, state);
  const filter = getFilter();
  const wrongImages = questions.filter((question) => getImageStatus(exam, question.id, state) === 'wrong_image');
  const currentQuestion = findCurrentQuestion(exam, questions, state);

  container.innerHTML = `
    <section class="view-stack exam-image-review">
      <button class="text-back" type="button" data-route="/exam/${exam.id}">← ${escapeHTML(exam.title)}</button>
      <div class="view-heading compact">
        <p class="eyebrow">Outil temporaire image review</p>
        <h1>${escapeHTML(exam.title)}</h1>
        <p>Question ${currentQuestion.index + 1} / ${questions.length}</p>
      </div>
      <div class="exam-summary-grid">
        <section class="metric-card"><span>Vérifiées</span><strong>${counts.reviewed}</strong></section>
        <section class="metric-card"><span>Images à remplacer</span><strong>${counts.wrong}</strong></section>
        <section class="metric-card"><span>Progression</span><strong>${counts.progress}%</strong></section>
        <section class="metric-card"><span>Total</span><strong>${questions.length}</strong></section>
      </div>
      <div class="review-filters">
        <button type="button" data-image-review-filter="all" class="${filter === 'all' ? 'active' : ''}">Toutes</button>
        <button type="button" data-image-review-filter="wrong" class="${filter === 'wrong' ? 'active' : ''}">Images à remplacer</button>
      </div>
      ${filter === 'wrong' ? renderWrongImages(exam, wrongImages) : renderImageQuestion(exam, questions, currentQuestion)}
    </section>
  `;

  bindRouteLinks(container);
  bindFilters(container, exam);
  if (filter === 'wrong') bindExportActions(container, exam, wrongImages);
  if (filter === 'all') bindImageQuestionActions(container, exam, questions, currentQuestion.index, currentUser);
}

export function renderExamReviewQuestion(container, params, currentUser) {
  const exam = getExam(params.type);
  if (!exam) return renderUnknown(container);
  if (!canReview(exam, currentUser)) return renderReviewBlocked(container, exam);
  const questions = getAllQuestions(exam);
  const index = questions.findIndex((question) => question.id.toLowerCase() === String(params.questionId || '').toLowerCase());
  if (index < 0) return renderUnknown(container);
  sessionStorage.setItem(currentIndexKey(exam), String(index));
  renderExamReviewDashboard(container, params, currentUser);
}

function renderImageQuestion(exam, questions, current) {
  const question = current.question;
  const previous = questions[current.index - 1];
  const next = questions[current.index + 1];
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
        <h2>Fichier</h2>
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
        <button type="button" data-image-review-status="correct">Image correcte</button>
        <button type="button" data-image-review-status="wrong_image">Image à remplacer</button>
      </div>
      <nav class="review-question-nav" aria-label="Navigation image review">
        ${previous ? `<button type="button" data-image-review-nav="-1">← ${escapeHTML(previous.id)}</button>` : '<span></span>'}
        <strong>${escapeHTML(question.id)} / ${questions.length}</strong>
        ${next ? `<button type="button" data-image-review-nav="1">${escapeHTML(next.id)} →</button>` : '<span></span>'}
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
          <button type="button" data-route="/exam-review/${exam.id}/${question.id}">
            <strong>${escapeHTML(question.id)}</strong>
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

function bindImageQuestionActions(container, exam, questions, index, currentUser) {
  const rerender = () => renderExamReviewDashboard(container, { type: exam.id }, currentUser);
  container.querySelectorAll('[data-image-review-status]').forEach((button) => {
    button.addEventListener('click', () => {
      const question = questions[index];
      setImageStatus(exam, question.id, button.dataset.imageReviewStatus);
      const nextIndex = Math.min(index + 1, questions.length - 1);
      sessionStorage.setItem(currentIndexKey(exam), String(nextIndex));
      rerender();
    });
  });
  container.querySelectorAll('[data-image-review-nav]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextIndex = Math.max(0, Math.min(index + Number(button.dataset.imageReviewNav), questions.length - 1));
      sessionStorage.setItem(currentIndexKey(exam), String(nextIndex));
      rerender();
    });
  });
  document.onkeydown = (event) => {
    if (!location.hash.includes(`/exam-review/${exam.id}`)) return;
    if (event.key.toLowerCase() === 'c') container.querySelector('[data-image-review-status="correct"]')?.click();
    if (event.key.toLowerCase() === 'x') container.querySelector('[data-image-review-status="wrong_image"]')?.click();
    if (event.key === 'ArrowLeft') container.querySelector('[data-image-review-nav="-1"]')?.click();
    if (event.key === 'ArrowRight') container.querySelector('[data-image-review-nav="1"]')?.click();
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
    const text = data.map((item) => `${item.questionId} | ${item.image}`).join('\n');
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
      navigateTo(filter === 'wrong' ? `/exam-review/${exam.id}?filter=wrong` : `/exam-review/${exam.id}`);
    });
  });
}

function findCurrentQuestion(exam, questions) {
  const index = Math.max(0, Math.min(Number(sessionStorage.getItem(currentIndexKey(exam)) || 0), questions.length - 1));
  return { index, question: questions[index] };
}

function countStatuses(exam, questions, state) {
  const reviewed = questions.filter((question) => ['correct', 'wrong_image'].includes(getImageStatus(exam, question.id, state))).length;
  const wrong = questions.filter((question) => getImageStatus(exam, question.id, state) === 'wrong_image').length;
  return {
    reviewed,
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
  return state[exam.id]?.[questionId] || '';
}

function setImageStatus(exam, questionId, status) {
  const state = readImageReviewState();
  state[exam.id] = { ...(state[exam.id] || {}), [questionId]: status };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function currentIndexKey(exam) {
  return `examImageReview:${exam.id}:index`;
}

function getFilter() {
  return new URLSearchParams(window.location.hash.split('?')[1] || '').get('filter') === 'wrong' ? 'wrong' : 'all';
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
      <button class="text-back" type="button" data-route="/exams">← Préparation examens</button>
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
