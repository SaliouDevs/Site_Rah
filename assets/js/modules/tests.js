import { TEST_SERIES_DATA } from '../data/tests-data.js';
import { navigateTo } from '../router.js';

let activeTest = null;

export function renderTestsView(container) {
  activeTest = null;
  setBottomNavVisible(true);
  container.innerHTML = `
    <section class="view-stack">
      <div class="view-heading">
        <p class="eyebrow">Entraînement</p>
        <h1>Tests</h1>
        <p>Conserve les séries existantes et réponds question par question avec feedback clair.</p>
      </div>
      <div class="test-series-grid">
        ${Object.entries(TEST_SERIES_DATA).map(([key, serie]) => `
          <button class="test-series-card" type="button" data-start-series="${key}">
            <strong>Niveau ${key.replace('T', '')}</strong>
            <span>${serie.questions.length} questions</span>
            <small>Réussite : 7 / 10</small>
          </button>
        `).join('')}
      </div>
      <div class="recent-note">
        <strong>Essais récents</strong>
        <span>${getRecentTestsLabel()}</span>
      </div>
    </section>
  `;

  container.querySelectorAll('[data-start-series]').forEach((button) => {
    button.addEventListener('click', () => startSeries(container, button.dataset.startSeries));
  });
}

function startSeries(container, seriesKey) {
  const series = TEST_SERIES_DATA[seriesKey];
  setBottomNavVisible(false);
  activeTest = {
    seriesKey,
    questions: series.questions,
    currentIndex: 0,
    answers: {},
    validated: false
  };
  renderQuestion(container);
}

function renderQuestion(container) {
  const question = activeTest.questions[activeTest.currentIndex];
  const selected = activeTest.answers[activeTest.currentIndex];
  container.innerHTML = `
    <section class="test-active immersive-view">
      <button class="text-back" type="button" data-quit-test>← Quitter</button>
      <div class="test-question-panel">
        <div class="reader-meta">
          <span>Niveau ${activeTest.seriesKey.replace('T', '')}</span>
          <strong>Question ${activeTest.currentIndex + 1} / ${activeTest.questions.length}</strong>
        </div>
        ${question.image ? `<img class="question-image" src="${question.image}" alt="Illustration de la question" loading="lazy">` : ''}
        <h1>${question.text}</h1>
        <div class="test-options">
          ${Object.entries(question.options).map(([key, value]) => `
            <button type="button" data-test-answer="${key}" class="${selected === key ? 'selected' : ''}">
              <span>${key}</span>
              <strong>${value}</strong>
            </button>
          `).join('')}
        </div>
        <div class="quiz-feedback" data-feedback></div>
        <div class="reader-actions">
          <button class="primary-action" type="button" data-validate-answer ${selected ? '' : 'disabled'}>Valider</button>
        </div>
      </div>
    </section>
  `;

  bindQuestionControls(container, question);
}

function bindQuestionControls(container, question) {
  container.querySelector('[data-quit-test]').addEventListener('click', () => {
    window.eautoConfirm({
      title: 'Quitter le test ?',
      message: 'Ta progression actuelle dans cette série sera perdue.',
      confirmLabel: 'Quitter',
      cancelLabel: 'Continuer le test',
      onConfirm: () => {
        setBottomNavVisible(true);
        navigateTo('/tests');
      }
    });
  });

  container.querySelectorAll('[data-test-answer]').forEach((button) => {
    button.addEventListener('click', () => {
      activeTest.answers[activeTest.currentIndex] = button.dataset.testAnswer;
      container.querySelectorAll('[data-test-answer]').forEach((item) => item.classList.remove('selected'));
      button.classList.add('selected');
      container.querySelector('[data-validate-answer]').disabled = false;
    });
  });

  container.querySelector('[data-validate-answer]').addEventListener('click', () => {
    const answer = activeTest.answers[activeTest.currentIndex];
    const correct = answer === question.correctAnswer;
    const feedback = container.querySelector('[data-feedback]');
    feedback.className = `quiz-feedback ${correct ? 'correct' : 'wrong'}`;
    feedback.innerHTML = `<strong>${correct ? 'Correct' : 'À revoir'}</strong><span>${question.explanation || `La bonne réponse est ${question.correctAnswer}.`}</span>`;
    container.querySelectorAll('[data-test-answer]').forEach((button) => {
      button.disabled = true;
      if (button.dataset.testAnswer === question.correctAnswer) {
        button.classList.add('correct');
      } else if (button.dataset.testAnswer === answer) {
        button.classList.add('wrong');
      }
    });
    container.querySelector('[data-validate-answer]').outerHTML = `<button class="primary-action" type="button" data-next-question>${activeTest.currentIndex === activeTest.questions.length - 1 ? 'Voir les résultats' : 'Question suivante →'}</button>`;
    container.querySelector('[data-next-question]').addEventListener('click', () => {
      if (activeTest.currentIndex === activeTest.questions.length - 1) {
        renderResults(container);
      } else {
        activeTest.currentIndex += 1;
        renderQuestion(container);
      }
    });
  });
}

function renderResults(container) {
  const score = activeTest.questions.reduce((sum, question, index) => {
    return sum + (activeTest.answers[index] === question.correctAnswer ? 1 : 0);
  }, 0);
  const percentage = Math.round((score / activeTest.questions.length) * 100);
  saveRecentTest(activeTest.seriesKey, score, percentage);

  container.innerHTML = `
    <section class="test-result-view immersive-view">
      <div class="reader-panel result-panel ${score >= 7 ? 'passed' : 'failed'}">
        <div class="result-check">${score >= 7 ? '✓' : '!'}</div>
        <p class="eyebrow">Résultat</p>
        <h1>${score} / ${activeTest.questions.length}</h1>
        <p>${percentage} % · ${score >= 7 ? 'Série réussie' : 'Encore un peu de révision'}</p>
        <div class="reader-actions">
          <button class="primary-action" type="button" data-retry-test>Recommencer</button>
          <button class="secondary-action" type="button" data-tests-home>Retour aux tests</button>
        </div>
      </div>
    </section>
  `;
  const seriesKey = activeTest.seriesKey;
  container.querySelector('[data-retry-test]').addEventListener('click', () => startSeries(container, seriesKey));
  container.querySelector('[data-tests-home]').addEventListener('click', () => {
    setBottomNavVisible(true);
    navigateTo('/tests');
  });
}

function setBottomNavVisible(isVisible) {
  const nav = document.getElementById('bottom-nav');
  if (nav) {
    nav.style.display = isVisible ? 'flex' : 'none';
  }
}

function saveRecentTest(seriesKey, score, percentage) {
  const key = 'eautoecole.testHistory';
  const history = JSON.parse(localStorage.getItem(key) || '[]');
  history.unshift({ seriesKey, score, percentage, date: new Date().toISOString() });
  localStorage.setItem(key, JSON.stringify(history.slice(0, 5)));
}

function getRecentTestsLabel() {
  const history = JSON.parse(localStorage.getItem('eautoecole.testHistory') || '[]');
  if (!history.length) {
    return 'Aucun test récent';
  }
  const last = history[0];
  return `${last.seriesKey} · ${last.score}/10 · ${last.percentage}%`;
}
