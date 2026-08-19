import { getAllQuestions, getExam } from './exam-engine.js';
import { navigateTo } from '../router.js';

const STATUS = {
  pending: { label: 'À vérifier', className: 'pending' },
  verified: { label: 'Vérifiée', className: 'verified' },
  image_issue: { label: 'Image à corriger', className: 'warning' },
  question_issue: { label: 'Question à revoir', className: 'warning' }
};

export function renderExamReviewDashboard(container, params, currentUser) {
  const exam = getExam(params.type);
  if (!exam) return renderUnknown(container);
  if (!canReview(exam, currentUser)) return renderReviewBlocked(container, exam);
  setBottomNavVisible(true);

  const questions = getAllQuestions(exam);
  const filter = new URLSearchParams(window.location.hash.split('?')[1] || '').get('filter') || 'all';
  const statuses = readReviewState();
  const counts = countStatuses(exam, questions, statuses);
  const filtered = filterQuestions(exam, questions, statuses, filter);
  const progress = questions.length ? Math.round((counts.verified / questions.length) * 100) : 0;

  container.innerHTML = `
    <section class="view-stack exam-review-dashboard">
      <button class="text-back" type="button" data-route="/exam/${exam.id}">← ${escapeHTML(exam.title)}</button>
      <div class="view-heading compact">
        <p class="eyebrow">Révision des questions</p>
        <h1>${escapeHTML(exam.title)}</h1>
      </div>
      <div class="exam-summary-grid">
        <section class="metric-card"><span>Questions</span><strong>${questions.length}</strong></section>
        <section class="metric-card"><span>Vérifiées</span><strong>${counts.verified}</strong></section>
        <section class="metric-card"><span>Images à corriger</span><strong>${counts.image_issue}</strong></section>
        <section class="metric-card"><span>Questions à revoir</span><strong>${counts.question_issue}</strong></section>
      </div>
      <section class="exam-panel">
        <div class="progress-meta"><span>Progression audit</span><strong>${progress} %</strong></div>
        <div class="progress-track"><span style="width:${progress}%"></span></div>
      </section>
      <div class="review-filters">
        ${[
          ['all', 'Toutes'],
          ['pending', 'À vérifier'],
          ['image_issue', 'Image incorrecte'],
          ['question_issue', 'Question à revoir'],
          ['verified', 'Vérifiées']
        ].map(([key, label]) => `<button type="button" data-review-filter="${key}" class="${filter === key ? 'active' : ''}">${label}</button>`).join('')}
      </div>
      <div class="review-question-grid">
        ${filtered.map((question) => {
          const status = getQuestionStatus(exam, question.id, statuses);
          return `
            <button class="review-question-card ${STATUS[status].className}" type="button" data-review-question="${question.id}">
              <strong>${escapeHTML(question.id)}</strong>
              <span>${escapeHTML(STATUS[status].label)}</span>
            </button>
          `;
        }).join('')}
      </div>
    </section>
  `;
  bindRouteLinks(container);
  container.querySelectorAll('[data-review-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextFilter = button.dataset.reviewFilter;
      navigateTo(nextFilter === 'all' ? `/exam-review/${exam.id}` : `/exam-review/${exam.id}?filter=${nextFilter}`);
    });
  });
  container.querySelectorAll('[data-review-question]').forEach((button) => {
    button.addEventListener('click', () => navigateTo(`/exam-review/${exam.id}/${button.dataset.reviewQuestion}`));
  });
}

export function renderExamReviewQuestion(container, params, currentUser) {
  const exam = getExam(params.type);
  if (!exam) return renderUnknown(container);
  if (!canReview(exam, currentUser)) return renderReviewBlocked(container, exam);
  setBottomNavVisible(true);

  const questions = getAllQuestions(exam);
  const index = questions.findIndex((question) => question.id.toLowerCase() === String(params.questionId || '').toLowerCase());
  if (index < 0) return renderUnknown(container);
  const question = questions[index];
  const statuses = readReviewState();
  const status = getQuestionStatus(exam, question.id, statuses);
  const previous = questions[index - 1];
  const next = questions[index + 1];

  container.innerHTML = `
    <section class="view-stack exam-review-question">
      <button class="text-back" type="button" data-route="/exam-review/${exam.id}">← Révision ${escapeHTML(exam.title)}</button>
      <article class="exam-panel review-detail-panel">
        <div class="review-detail-heading">
          <div>
            <p class="eyebrow">${escapeHTML(question.id)}</p>
            <h1>Question ${question.number}</h1>
          </div>
          <span class="review-status ${STATUS[status].className}">${escapeHTML(STATUS[status].label)}</span>
        </div>
        <section class="review-detail-section">
          <h2>Image actuelle</h2>
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
        <section class="review-detail-section">
          <h2>Réponse correcte</h2>
          <p>${escapeHTML(formatCorrectAnswer(question))}</p>
        </section>
        <div class="review-status-actions">
          <button type="button" data-review-status="verified" class="${status === 'verified' ? 'active' : ''}">Vérifiée</button>
          <button type="button" data-review-status="image_issue" class="${status === 'image_issue' ? 'active' : ''}">Image à corriger</button>
          <button type="button" data-review-status="question_issue" class="${status === 'question_issue' ? 'active' : ''}">Question à revoir</button>
        </div>
      </article>
      <nav class="review-question-nav" aria-label="Navigation review">
        ${previous ? `<button type="button" data-route="/exam-review/${exam.id}/${previous.id}">← ${escapeHTML(previous.id)}</button>` : '<span></span>'}
        <strong>${escapeHTML(question.id)} / ${questions.length}</strong>
        ${next ? `<button type="button" data-route="/exam-review/${exam.id}/${next.id}">${escapeHTML(next.id)} →</button>` : '<span></span>'}
      </nav>
    </section>
  `;
  bindRouteLinks(container);
  container.querySelectorAll('[data-review-status]').forEach((button) => {
    button.addEventListener('click', () => {
      setQuestionStatus(exam, question.id, button.dataset.reviewStatus);
      renderExamReviewQuestion(container, params, currentUser);
    });
  });
}

export function readReviewState() {
  try {
    return JSON.parse(localStorage.getItem('examReview') || '{}');
  } catch (_) {
    return {};
  }
}

export function getQuestionStatus(exam, questionId, state = readReviewState()) {
  return state[exam.id]?.[questionId] || 'pending';
}

function setQuestionStatus(exam, questionId, status) {
  const state = readReviewState();
  state[exam.id] = { ...(state[exam.id] || {}), [questionId]: status };
  localStorage.setItem('examReview', JSON.stringify(state));
}

function countStatuses(exam, questions, statuses) {
  return questions.reduce((acc, question) => {
    const status = getQuestionStatus(exam, question.id, statuses);
    acc[status] += 1;
    return acc;
  }, { pending: 0, verified: 0, image_issue: 0, question_issue: 0 });
}

function filterQuestions(exam, questions, statuses, filter) {
  if (filter === 'all') return questions;
  return questions.filter((question) => getQuestionStatus(exam, question.id, statuses) === filter);
}

function canReview(exam, currentUser) {
  if (typeof window.isExamEnabled === 'function' && window.isExamEnabled(exam.id)) return true;
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

function formatCorrectAnswer(question) {
  if (question.optionType === 'type3') return `1: ${question.type3CorrectAnswer1 || '-'}, 2: ${question.type3CorrectAnswer2 || '-'}`;
  if (Array.isArray(question.correctAnswer)) return question.correctAnswer.join(', ');
  return question.correctAnswer || '-';
}

function renderReviewBlocked(container, exam) {
  setBottomNavVisible(true);
  container.innerHTML = `
    <section class="view-stack">
      <button class="text-back" type="button" data-route="/exams">← Préparation examens</button>
      <div class="empty-state">
        <h1>Review indisponible</h1>
        <p>${escapeHTML(exam.title)} est en correction et la review est réservée à l'administration.</p>
      </div>
    </section>
  `;
  bindRouteLinks(container);
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
