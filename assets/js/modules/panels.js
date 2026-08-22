import { PANELS_DATA } from '../data/panels-data.js';
import { navigateTo } from '../router.js';

let currentCategoryKey = null;
let currentIndex = 0;
let revisionScore = { correct: 0, total: 0 };
let currentPlayback = null;
let playbackSequence = 0;

export function renderPanelsView(container, params = {}) {
  const categoryId = params.category;
  if (categoryId) {
    renderPanelCategory(container, categoryId);
    return;
  }

  stopPanelPlayback();
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
      stopPanelPlayback();
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
  stopPanelPlayback();
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
    stopPanelPlayback();
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
  container.querySelector('[data-panel-details]').addEventListener('click', () => {
    stopPanelPlayback();
    showPanelDetails(category, sign);
  });
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
        ${hasFr ? renderMediaPlayer(sign.audioFr, 'Français', 'fr') : renderSpeechButton()}
        ${hasWo ? renderMediaPlayer(sign.audioWo, 'Wolof / SN', 'wo') : `
          <div class="panel-media-empty">
            <span class="panel-language-badge wo">SN</span>
            <span><strong>Wolof / SN</strong><small>Audio non publié pour ce panneau</small></span>
          </div>`}
      </div>
    </section>
  `;
}

function renderSpeechButton() {
  return `
    <button class="panel-play-card" type="button" data-panel-tts aria-pressed="false">
      <span class="panel-language-badge">FR</span>
      <span class="panel-play-copy"><strong>Français</strong><small>Lecture vocale du texte</small></span>
      <span class="panel-play-action" aria-hidden="true"><i class="fas fa-play"></i></span>
    </button>`;
}

function renderMediaPlayer(src, label, language) {
  const isVideo = isVideoSource(src);
  const languageClass = language === 'wo' ? 'wo' : '';
  const languageCode = language === 'wo' ? 'SN' : 'FR';
  if (isVideo) {
    return `
      <div class="panel-media-card panel-media-video">
        <div class="panel-media-label"><span class="panel-language-badge ${languageClass}">${languageCode}</span><strong>${escapeHTML(label)}</strong></div>
        <video controls playsinline preload="metadata" src="${escapeAttr(src)}" data-panel-video></video>
      </div>`;
  }
  return `
    <button class="panel-play-card" type="button" data-panel-audio="${escapeAttr(src)}" aria-pressed="false">
      <span class="panel-language-badge ${languageClass}">${languageCode}</span>
      <span class="panel-play-copy"><strong>${escapeHTML(label)}</strong><small data-panel-audio-status>Audio auto-école</small></span>
      <span class="panel-play-action" aria-hidden="true"><i class="fas fa-play"></i></span>
    </button>`;
}

function bindPanelMedia(scope, sign) {
  scope.querySelectorAll('[data-panel-tts]').forEach((button) => {
    button.addEventListener('click', () => toggleFrenchSpeech(`${sign.name}. ${sign.description || ''}`, button));
  });
  scope.querySelectorAll('[data-panel-audio]').forEach((button) => {
    button.addEventListener('click', () => togglePanelAudio(button));
  });
  scope.querySelectorAll('[data-panel-video]').forEach((video) => bindPanelVideo(video));
}

function toggleFrenchSpeech(text, button) {
  if (currentPlayback?.kind === 'speech' && currentPlayback.button === button) {
    stopPanelPlayback();
    return;
  }
  stopPanelPlayback();
  if (!('speechSynthesis' in window)) {
    window.eautoToast?.('Lecture vocale indisponible sur cet appareil.');
    return;
  }

  const sequence = ++playbackSequence;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'fr-FR';
  currentPlayback = { kind: 'speech', button, utterance, sequence };
  setPlaybackButtonState(button, true, 'Lecture en cours');

  const done = () => {
    if (currentPlayback?.sequence !== sequence) return;
    currentPlayback = null;
    setPlaybackButtonState(button, false, 'Lecture vocale du texte');
  };
  utterance.onend = done;
  utterance.onerror = done;
  window.speechSynthesis.speak(utterance);
}

function togglePanelAudio(button) {
  if (currentPlayback?.kind === 'audio' && currentPlayback.button === button) {
    stopPanelPlayback();
    return;
  }

  const src = button.dataset.panelAudio;
  if (!src) return;
  stopPanelPlayback();

  const sequence = ++playbackSequence;
  const audio = new Audio(src);
  audio.preload = 'metadata';
  currentPlayback = { kind: 'audio', button, element: audio, sequence };
  setPlaybackButtonState(button, true, 'Lecture en cours');

  audio.addEventListener('loadedmetadata', () => {
    if (currentPlayback?.sequence !== sequence) return;
    const duration = formatTime(audio.duration);
    setPlaybackStatus(button, duration ? `Lecture en cours · ${duration}` : 'Lecture en cours');
  });
  audio.addEventListener('ended', () => finishMediaPlayback(sequence, button, 'Audio auto-école'));
  audio.addEventListener('error', () => {
    if (currentPlayback?.sequence !== sequence) return;
    stopPanelPlayback();
    window.eautoToast?.('Impossible de lire cet audio.');
  });

  const playPromise = audio.play();
  if (playPromise?.catch) {
    playPromise.catch(() => {
      if (currentPlayback?.sequence !== sequence) return;
      stopPanelPlayback();
      window.eautoToast?.('Lecture audio bloquée par le navigateur. Réessaie.');
    });
  }
}

function bindPanelVideo(video) {
  video.addEventListener('play', () => {
    if (currentPlayback?.kind === 'video' && currentPlayback.element === video) return;
    stopPanelPlayback();
    const sequence = ++playbackSequence;
    currentPlayback = { kind: 'video', element: video, sequence };
  });
  const clearVideo = () => {
    if (currentPlayback?.kind === 'video' && currentPlayback.element === video) currentPlayback = null;
  };
  video.addEventListener('pause', clearVideo);
  video.addEventListener('ended', clearVideo);
}

function finishMediaPlayback(sequence, button, idleLabel) {
  if (currentPlayback?.sequence !== sequence) return;
  currentPlayback = null;
  setPlaybackButtonState(button, false, idleLabel);
}

function stopPanelPlayback() {
  playbackSequence += 1;
  const active = currentPlayback;
  currentPlayback = null;

  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  if (active?.element) {
    active.element.pause();
    try { active.element.currentTime = 0; } catch {}
  }
  if (active?.button) {
    const idleLabel = active.kind === 'speech' ? 'Lecture vocale du texte' : 'Audio auto-école';
    setPlaybackButtonState(active.button, false, idleLabel);
  }
}

function setPlaybackButtonState(button, playing, status) {
  if (!button) return;
  button.classList.toggle('playing', playing);
  button.setAttribute('aria-pressed', playing ? 'true' : 'false');
  const icon = button.querySelector('.panel-play-action i');
  if (icon) icon.className = `fas ${playing ? 'fa-stop' : 'fa-play'}`;
  setPlaybackStatus(button, status);
}

function setPlaybackStatus(button, text) {
  const status = button?.querySelector('[data-panel-audio-status], .panel-play-copy small');
  if (status) status.textContent = text;
}

function formatTime(value) {
  if (!Number.isFinite(value) || value <= 0) return '';
  const total = Math.round(value);
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function isVideoSource(src) {
  const clean = String(src || '').split('?')[0].toLowerCase();
  return /\.(mp4|mov|m4v|webm|mpeg|mpg)$/.test(clean);
}

function renderPanelReview(root) {
  stopPanelPlayback();
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
