(function () {
  const STATUS = {
    verified: { label: 'Verifiee', text: 'Verifiee', mark: 'OK' },
    image: { label: 'Image a corriger', text: 'Image', mark: 'IMG' },
    question: { label: 'Question a revoir', text: 'Question', mark: 'Q' }
  };

  function initExamReview(config) {
    const state = {
      config,
      questions: buildQuestionList(config),
      currentIndex: 0,
      enabled: new URLSearchParams(window.location.search).get('review') === '1'
    };

    injectStyle();
    ensureReviewRoot(state);
    renderSummary(state);

    if (state.enabled) {
      document.body.classList.add('exam-review-active');
    }

    return {
      refresh() {
        syncCurrentIndex(state);
        renderQuestionReview(state);
        renderSummary(state);
      },
      openBySeriesQuestion(series, questionNumber) {
        const index = state.questions.findIndex((item) => item.series === series && item.number === questionNumber);
        openReviewQuestion(state, Math.max(0, index));
      },
      getInventory() {
        return state.questions.map((item) => ({
          examId: config.examId,
          questionId: item.id,
          series: item.series,
          number: item.number,
          currentImage: item.question.image || '',
          exists: null,
          references: [],
          reviewStatus: getStatus(config.examId, item.id)
        }));
      }
    };
  }

  function buildQuestionList(config) {
    const seriesData = config.getSeriesData();
    const prefix = config.questionPrefix;
    let count = 0;
    return Object.keys(seriesData).flatMap((seriesKey) => {
      const questions = seriesData[seriesKey].questions || [];
      return questions.map((question, index) => {
        count += 1;
        return {
          id: `${prefix}-${String(count).padStart(3, '0')}`,
          series: seriesKey,
          number: index + 1,
          globalNumber: count,
          question
        };
      });
    });
  }

  function ensureReviewRoot(state) {
    if (!document.getElementById('exam-review-summary')) {
      const summary = document.createElement('section');
      summary.id = 'exam-review-summary';
      summary.className = 'exam-review-summary';
      document.querySelector('.main-container')?.before(summary);
    }

    if (!document.getElementById('exam-review-panel')) {
      const panel = document.createElement('aside');
      panel.id = 'exam-review-panel';
      panel.className = 'exam-review-panel';
      document.getElementById('exam-container')?.appendChild(panel);
    }

    document.getElementById('exam-review-summary')?.addEventListener('click', (event) => {
      const target = event.target.closest('[data-review-index]');
      if (target) openReviewQuestion(state, Number(target.dataset.reviewIndex));
    });

    document.getElementById('exam-review-panel')?.addEventListener('click', (event) => {
      const statusButton = event.target.closest('[data-review-status]');
      if (statusButton) {
        const item = state.questions[state.currentIndex];
        setStatus(state.config.examId, item.id, statusButton.dataset.reviewStatus);
        renderQuestionReview(state);
        renderSummary(state);
        return;
      }

      const navButton = event.target.closest('[data-review-nav]');
      if (navButton) {
        const nextIndex = state.currentIndex + Number(navButton.dataset.reviewNav);
        openReviewQuestion(state, nextIndex);
      }
    });
  }

  function openReviewQuestion(state, index) {
    if (index < 0 || index >= state.questions.length) return;
    state.enabled = true;
    document.body.classList.add('exam-review-active');
    const item = state.questions[index];
    state.currentIndex = index;
    state.config.openQuestion(item.series, item.number);
    renderQuestionReview(state);
    renderSummary(state);
  }

  function syncCurrentIndex(state) {
    const series = state.config.getCurrentSeries();
    const number = state.config.getCurrentQuestion();
    const index = state.questions.findIndex((item) => item.series === series && item.number === number);
    if (index >= 0) state.currentIndex = index;
  }

  function renderSummary(state) {
    const root = document.getElementById('exam-review-summary');
    if (!root) return;
    const counts = countStatuses(state);
    root.innerHTML = `
      <div class="review-heading">
        <div>
          <p>Mode review</p>
          <h2>Revision ${escapeHTML(state.config.title)}</h2>
        </div>
        <button type="button" data-review-index="0">Ouvrir</button>
      </div>
      <div class="review-metrics">
        <span><strong>${state.questions.length}</strong> questions</span>
        <span><strong>${counts.verified}</strong> verifiees</span>
        <span><strong>${counts.image}</strong> images a corriger</span>
        <span><strong>${counts.question}</strong> questions a revoir</span>
      </div>
      <div class="review-list">
        ${state.questions.map((item, index) => {
          const status = getStatus(state.config.examId, item.id);
          return `<button type="button" data-review-index="${index}" class="${status === 'verified' ? 'ok' : status ? 'warn' : ''}">${item.id} ${statusLabel(status)}</button>`;
        }).join('')}
      </div>
    `;
  }

  function renderQuestionReview(state) {
    const panel = document.getElementById('exam-review-panel');
    if (!panel || !state.enabled) return;
    const item = state.questions[state.currentIndex];
    const question = item.question;
    const image = question.image || '';
    const status = getStatus(state.config.examId, item.id);
    panel.innerHTML = `
      <div class="review-question-meta">
        <strong>Question ${item.id}</strong>
        <span>${escapeHTML(item.series)} / numero ${item.number}</span>
      </div>
      <div class="review-image-path">
        <span>Image actuelle</span>
        <code>${escapeHTML(image || 'Aucune image')}</code>
      </div>
      ${image ? `<img class="review-current-image" src="${escapeAttribute(image)}" alt="">` : '<div class="review-no-image">Aucune image</div>'}
      <div class="review-block">
        <span>Question</span>
        <p>${escapeHTML(question.text || '')}</p>
      </div>
      <div class="review-block">
        <span>Reponses</span>
        ${renderAnswers(question)}
      </div>
      <div class="review-block">
        <span>Reponse correcte</span>
        <p>${escapeHTML(formatCorrectAnswer(question))}</p>
      </div>
      <div class="review-statuses">
        ${Object.keys(STATUS).map((key) => `<button type="button" data-review-status="${key}" class="${status === key ? 'active' : ''}">${STATUS[key].label}</button>`).join('')}
      </div>
      <div class="review-nav">
        <button type="button" data-review-nav="-1" ${state.currentIndex === 0 ? 'disabled' : ''}>Precedente</button>
        <button type="button" data-review-nav="1" ${state.currentIndex === state.questions.length - 1 ? 'disabled' : ''}>Suivante</button>
      </div>
    `;
  }

  function renderAnswers(question) {
    if (question.optionType === 'type3') {
      return `
        <ul>
          <li>${escapeHTML(question.type3Q1Text1 || '')}</li>
          <li>${escapeHTML(question.type3Q1Text2 || '')}</li>
          <li>${escapeHTML(question.type3Q2Text1 || '')}</li>
          <li>${escapeHTML(question.type3Q2Text2 || '')}</li>
        </ul>
      `;
    }
    if (question.optionType === 'type4' || question.optionType === 'type4_multiple') {
      return `
        <ul>
          ${['type4Text1', 'type4Text2', 'type4Text3', 'type4Text4'].map((key, index) => {
            if (!question[key]) return '';
            return `<li>${String.fromCharCode(65 + index)}. ${escapeHTML(question[key])}</li>`;
          }).join('')}
        </ul>
      `;
    }
    return '<ul><li>A. OUI</li><li>B. NON</li></ul>';
  }

  function formatCorrectAnswer(question) {
    if (question.optionType === 'type3') {
      return `1: ${question.type3CorrectAnswer1 || '-'}, 2: ${question.type3CorrectAnswer2 || '-'}`;
    }
    if (Array.isArray(question.correctAnswer)) return question.correctAnswer.join(', ');
    return question.correctAnswer || '-';
  }

  function countStatuses(state) {
    return state.questions.reduce((acc, item) => {
      const status = getStatus(state.config.examId, item.id);
      if (status) acc[status] += 1;
      return acc;
    }, { verified: 0, image: 0, question: 0 });
  }

  function statusLabel(status) {
    if (status === 'verified') return 'OK';
    if (status === 'image') return 'IMG';
    if (status === 'question') return 'Q';
    return '';
  }

  function storageKey(examId) {
    return `examReview:${examId}`;
  }

  function readStatuses(examId) {
    try {
      return JSON.parse(localStorage.getItem(storageKey(examId)) || '{}');
    } catch (_) {
      return {};
    }
  }

  function getStatus(examId, questionId) {
    return readStatuses(examId)[questionId] || '';
  }

  function setStatus(examId, questionId, status) {
    const statuses = readStatuses(examId);
    statuses[questionId] = status;
    localStorage.setItem(storageKey(examId), JSON.stringify(statuses));
  }

  function injectStyle() {
    if (document.getElementById('exam-review-style')) return;
    const style = document.createElement('style');
    style.id = 'exam-review-style';
    style.textContent = `
      .exam-review-summary{max-width:1200px;margin:0 auto 18px;padding:14px;background:#fff;border:1px solid #d8dee8;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.06)}
      .review-heading{display:flex;justify-content:space-between;gap:12px;align-items:center}
      .review-heading p{margin:0;color:#667085;font-size:.78rem;font-weight:700;text-transform:uppercase}
      .review-heading h2{margin:2px 0 0;color:#1a3a6b;font-size:1.05rem}
      .review-heading button,.review-nav button,.review-statuses button{border:1px solid #1a3a6b;background:#fff;color:#1a3a6b;border-radius:6px;padding:7px 10px;font-weight:700;cursor:pointer}
      .review-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:12px 0}
      .review-metrics span{padding:8px;background:#f6f8fb;border-radius:6px;color:#344054;font-size:.84rem}
      .review-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:6px;max-height:170px;overflow:auto}
      .review-list button{border:1px solid #d8dee8;background:#fff;border-radius:5px;padding:6px;font-size:.78rem;text-align:left;cursor:pointer}
      .review-list button.ok{border-color:#2f9e44;color:#1f7a35;background:#eefbf1}
      .review-list button.warn{border-color:#d89614;color:#8a5a00;background:#fff8e8}
      .exam-review-panel{display:none;margin-top:16px;padding:14px;background:#f8fafc;border:1px solid #d8dee8;border-radius:8px;color:#1f2937}
      .exam-review-active .exam-review-panel{display:block}
      .review-question-meta{display:flex;justify-content:space-between;gap:10px;margin-bottom:10px}
      .review-image-path,.review-block{margin-top:10px}
      .review-image-path span,.review-block span{display:block;color:#667085;font-size:.78rem;font-weight:800;text-transform:uppercase;margin-bottom:3px}
      .review-image-path code{display:block;white-space:normal;word-break:break-word;background:#fff;border:1px solid #d8dee8;border-radius:5px;padding:7px}
      .review-current-image{display:block;max-height:180px;object-fit:contain;margin:10px auto;border:1px solid #d8dee8;border-radius:6px;background:#fff}
      .review-no-image{margin:10px 0;padding:18px;text-align:center;background:#fff;border:1px dashed #c7ceda;border-radius:6px;color:#667085}
      .review-block p{margin:0;padding:8px;background:#fff;border-radius:5px}
      .review-block ul{margin:0;padding:8px 8px 8px 26px;background:#fff;border-radius:5px}
      .review-statuses,.review-nav{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
      .review-statuses button.active{background:#1a3a6b;color:#fff}
      .review-nav{justify-content:space-between}
      .review-nav button:disabled{opacity:.45;cursor:not-allowed}
      @media(max-width:760px){.review-metrics{grid-template-columns:1fr 1fr}.review-question-meta{display:block}}
    `;
    document.head.appendChild(style);
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

  window.initExamReview = initExamReview;
})();
