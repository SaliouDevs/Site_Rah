import { PANELS_DATA } from '../data/panels-data.js';
import { navigateTo } from '../router.js';

let currentCategoryKey = null;
let currentIndex = 0;
let revisionScore = { correct: 0, total: 0 };
let currentSpeech = null;

export function renderPanelsView(container, params = {}) {
  const categoryId = params.category;
  if (categoryId) {
    renderPanelCategory(container, categoryId);
    return;
  }

  container.innerHTML = `
    <section class="view-stack">
      <div class="view-heading">
        <p class="eyebrow">Signaux routiers</p>
        <h1>Panneaux</h1>
        <p>Apprends catégorie par catégorie, puis révise avec reconnaissance visuelle.</p>
      </div>
      <div class="mode-grid">
        <button class="mode-card active" type="button" data-panel-mode="learn">
          <strong>Apprendre</strong>
          <span>Une fiche claire à la fois.</span>
        </button>
        <button class="mode-card" type="button" data-panel-mode="review">
          <strong>Réviser</strong>
          <span>Quel est ce panneau ?</span>
        </button>
      </div>
      <div data-panel-root></div>
    </section>
  `;

  const root = container.querySelector('[data-panel-root]');
  renderPanelCategories(root);
  container.querySelectorAll('[data-panel-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      stopPanelSpeech();
      container.querySelectorAll('[data-panel-mode]').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      if (button.dataset.panelMode === 'review') renderPanelReview(root);
      else renderPanelCategories(root);
    });
  });
}

function renderPanelCategories(root) {
  root.innerHTML = `
    <div class="category-grid">
      ${PANELS_DATA.map((category) => `
        <button class="category-tile" type="button" data-panel-category="${escapeAttr(category.id)}">
          <span>${category.logo || ''}</span>
          <strong>${escapeHTML(category.name)}</strong>
          <small>${category.signs.length} panneaux</small>
        </button>
      `).join('')}
    </div>
  `;

  root.querySelectorAll('[data-panel-category]').forEach((button) => {
    button.addEventListener('click', () => navigateTo(`/panels/${button.dataset.panelCategory}`));
  });
}

function renderPanelCategory(container, categoryId) {
  const category = PANELS_DATA.find((item) => item.id === categoryId) || PANELS_DATA[0];
  currentCategoryKey = category.id;
  currentIndex = Math.max(0, Math.min(currentIndex, category.signs.length - 1));
  renderCurrentPanel(container, category);
}

function renderCurrentPanel(container, category) {
  stopPanelSpeech();
  const sign = category.signs[currentIndex];
  container.innerHTML = `
    <section class="panel-study immersive-view">
      <button class="text-back" type="button" data-back-panels>← Toutes les catégories</button>
      <div class="panel-card-large">
        <div class="reader-meta">
          <span>${escapeHTML(category.name)}</span>
          <strong>${currentIndex + 1} / ${category.signs.length}</strong>
        </div>
        <div class="panel-visual">
          <img src="${escapeAttr(sign.image)}" alt="${escapeAttr(sign.name)}" loading="lazy">
        </div>
        <div class="panel-copy">
          <h1>${escapeHTML(sign.name)}</h1>
          <h2>Signification</h2>
          <p>${escapeHTML(sign.description || 'Description à consulter avec le moniteur.')}</p>
        </div>
        ${renderPanelMedia(sign)}
        <div class="reader-actions">
          <button class="secondary-action" type="button" data-prev-panel ${currentIndex === 0 ? 'disabled' : ''}>← Précédent</button>
          <button class="secondary-action" type="button" data-panel-details>Détails</button>
          <button class="primary-action" type="button" data-next-panel ${currentIndex === category.signs.length - 1 ? 'disabled' : ''}>Suivant →</button>
        </div>
      </div>
    </section>
  `;

  bindPanelMedia(container, sign);
  container.querySelector('[data-back-panels]').addEventListener('click', () => {
    stopPanelSpeech();
    currentIndex = 0;
    navigateTo('/panels');
  });
  container.querySelector('[data-prev-panel]').addEventListener('click', () => {
    currentIndex = Math.max(0, currentIndex - 1);
    renderCurrentPanel(container, category);
  });
  container.querySelector('[data-next-panel]').addEventListener('click', () => {
    currentIndex = Math.min(category.signs.length - 1, currentIndex + 1);
    renderCurrentPanel(container, category);
  });
  container.querySelector('[data-panel-details]').addEventListener('click', () => showPanelDetails(category, sign));
}

function renderPanelMedia(sign) {
  const hasFr = Boolean(sign.audioFr);
  const hasWo = Boolean(sign.audioWo);
  return `
    <section class="panel-media-section" aria-label="Écouter ce panneau">
      <div class="panel-media-heading">
        <div><span class="panel-media-kicker">Audio du panneau</span><strong>Écouter l'explication</strong></div>
        ${(hasFr || hasWo) ? '<span class="panel-media-live">Contenu auto-école</span>' : '<span class="panel-media-fallback">Lecture vocale</span>'}
      </div>
      <div class="panel-media-grid">
        ${hasFr ? renderMediaPlayer(sign.audioFr, 'Français', 'fr') : `
          <button class="panel-tts-card" type="button" data-panel-tts>
            <span class="panel-language-badge">FR</span>
            <span><strong>Français</strong><small>Lecture vocale du texte</small></span>
            <i class="fas fa-volume-high" aria-hidden="true"></i>
          </button>`}
        ${hasWo ? renderMediaPlayer(sign.audioWo, 'Wolof / SN', 'wo') : `
          <div class="panel-media-empty">
            <span class="panel-language-badge wo">SN</span>
            <span><strong>Wolof</strong><small>Audio non publié pour ce panneau</small></span>
          </div>`}
      </div>
    </section>
  `;
}

function renderMediaPlayer(src, label, language) {
  const isVideo = isVideoSource(src);
  if (isVideo) {
    return `
      <div class="panel-media-card panel-media-video">
        <div class="panel-media-label"><span class="panel-language-badge ${language === 'wo' ? 'wo' : ''}">${language === 'wo' ? 'SN' : 'FR'}</span><strong>${escapeHTML(label)}</strong></div>
        <video controls playsinline preload="metadata" src="${escapeAttr(src)}"></video>
      </div>`;
  }
  return `
    <div class="panel-media-card">
      <div class="panel-media-label"><span class="panel-language-badge ${language === 'wo' ? 'wo' : ''}">${language === 'wo' ? 'SN' : 'FR'}</span><strong>${escapeHTML(label)}</strong></div>
      <audio controls preload="none" src="${escapeAttr(src)}"></audio>
    </div>`;
}

function bindPanelMedia(scope, sign) {
  const ttsButton = scope.querySelector('[data-panel-tts]');
  if (!ttsButton) return;
  ttsButton.addEventListener('click', () => speakFrench(`${sign.name}. ${sign.description || ''}`, ttsButton));
}

function speakFrench(text, button) {
  stopPanelSpeech();
  if (!('speechSynthesis' in window)) {
    window.eautoToast?.('Lecture vocale indisponible sur cet appareil.');
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'fr-FR';
  currentSpeech = utterance;
  button.classList.add('playing');
  button.disabled = true;
  const done = () => {
    if (currentSpeech === utterance) currentSpeech = null;
    button.classList.remove('playing');
    button.disabled = false;
  };
  utterance.onend = done;
  utterance.onerror = done;
  window.speechSynthesis.speak(utterance);
}

function stopPanelSpeech() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  currentSpeech = null;
}

function isVideoSource(src) {
  const clean = String(src || '').split('?')[0].toLowerCase();
  return /\.(mp4|mov|m4v|webm|mpeg|mpg)$/.test(clean);
}

function renderPanelReview(root) {
  const allSigns = PANELS_DATA.flatMap((category) => category.signs.map((sign) => ({ ...sign, category: category.name })));
  const sign = allSigns[Math.floor(Math.random() * allSigns.length)];
  const options = buildReviewOptions(allSigns, sign);
  root.innerHTML = `
    <section class="review-card">
      <div class="reader-meta">
        <span>Révision panneaux</span>
        <strong>${revisionScore.correct} / ${revisionScore.total}</strong>
      </div>
      <h2>Quel est ce panneau ?</h2>
      <img src="${escapeAttr(sign.image)}" alt="Panneau à identifier" loading="lazy">
      <div class="quiz-options">
        ${options.map((option) => `<button type="button" data-review-answer="${escapeAttr(option.id)}">${escapeHTML(option.name)}</button>`).join('')}
      </div>
      <div class="quiz-feedback" data-feedback></div>
    </section>
  `;

  root.querySelectorAll('[data-review-answer]').forEach((button) => {
    button.addEventListener('click', () => {
      const correct = button.dataset.reviewAnswer === sign.id;
      revisionScore.total += 1;
      if (correct) revisionScore.correct += 1;
      const feedback = root.querySelector('[data-feedback]');
      feedback.className = `quiz-feedback ${correct ? 'correct' : 'wrong'}`;
      feedback.innerHTML = `<strong>${correct ? 'Correct' : 'À revoir'}</strong><span>${escapeHTML(sign.name)} : ${escapeHTML(sign.description || 'Relis la fiche de ce panneau.')}</span><button class="primary-action" type="button" data-next-review>Continuer</button>`;
      root.querySelectorAll('[data-review-answer]').forEach((item) => item.disabled = true);
      root.querySelector('[data-next-review]').addEventListener('click', () => renderPanelReview(root));
    });
  });
}

function buildReviewOptions(allSigns, sign) {
  const others = allSigns.filter((item) => item.id !== sign.id).sort(() => Math.random() - 0.5).slice(0, 2);
  return [sign, ...others].sort(() => Math.random() - 0.5);
}

function showPanelDetails(category, sign) {
  window.eautoModal(`
    <div class="modal-card panel-detail-modal">
      <button class="modal-close" type="button" data-close-modal aria-label="Fermer">×</button>
      <p class="eyebrow">${escapeHTML(category.name)}</p>
      <h2>${escapeHTML(sign.name)}</h2>
      <img class="modal-panel-image" src="${escapeAttr(sign.image)}" alt="${escapeAttr(sign.name)}" loading="lazy">
      <p>${escapeHTML(sign.description || 'Description à consulter avec le moniteur.')}</p>
      ${renderPanelMedia(sign)}
    </div>
  `);
  window.setTimeout(() => {
    const modal = document.querySelector('#modal-root .panel-detail-modal');
    if (modal) bindPanelMedia(modal, sign);
  }, 0);
}

export function getPanelsDataCount() {
  return PANELS_DATA.reduce((sum, category) => sum + category.signs.length, 0);
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
}
function escapeAttr(value) { return escapeHTML(value); }
